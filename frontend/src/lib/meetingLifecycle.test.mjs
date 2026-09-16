import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../pages/MeetingComplianceWorkflow.jsx', import.meta.url), 'utf8');
const stageCode = source.slice(source.indexOf('  const runStageAction ='), source.indexOf('  const loadRecordReviewSummary ='));
function stageHarness(stage, overrides = {}) {
  const events = [];
  const context = {
    activeStage: stage, stageActionRef: { current: false }, endingMeetingRef: { current: false },
    setStageActionPending: v => events.push(['busy', v]), setEndingMeeting: () => {},
    setRecording: v => events.push(['recording', v]),
    setActiveStage: v => events.push(['stage', v]),
    stopAndUploadDesktopAudio: async () => true,
    persistStage: async (next, phase) => { events.push(['persist', next, phase]); return true; },
    generateMeetingRecords: async () => { events.push(['generate']); return null; },
    message: { success: text => events.push(['success', text]), warning: text => events.push(['warning', text]) },
    isQuickMeeting: false, isMajorMeeting: false, effectiveMissingMaterialCount: 0, reviewDone: true,
    setRecorderInviteOpen: () => events.push(['invite']), window: { setTimeout: fn => fn() },
    ...overrides,
  };
  return { context, events, run: vm.runInNewContext(`${stageCode}; runStageAction`, context) };
}

test('failed start does not enter meeting, open invitation or capture microphone', async () => {
  const h = stageHarness('collect', { persistStage: async () => false });
  await h.run();
  assert.deepEqual(h.events, [['busy', true], ['busy', false]]);
});

test('start saves first and invites H5 without automatically recording on PC', async () => {
  const h = stageHarness('collect');
  await h.run();
  assert.equal(h.events[1][0], 'persist');
  assert.ok(h.events.some(e => e[0] === 'invite'));
  assert.ok(!h.events.some(e => e[0] === 'recording'));
});

test('failed PC save or blocked phone recording never starts post-meeting analysis', async () => {
  for (const overrides of [{ stopAndUploadDesktopAudio: async () => false }, { persistStage: async () => false }]) {
    const h = stageHarness('meeting', overrides);
    await h.run();
    assert.ok(!h.events.some(e => ['stage', 'generate', 'success'].includes(e[0])));
    assert.equal(h.context.endingMeetingRef.current, false);
  }
});

test('repeated end clicks submit and generate only once', async () => {
  let complete;
  const h = stageHarness('meeting', { stopAndUploadDesktopAudio: () => new Promise(resolve => { complete = resolve; }) });
  const pending = h.run();
  await h.run();
  complete(true);
  await pending;
  assert.equal(h.events.filter(e => e[0] === 'persist').length, 1);
  assert.equal(h.events.filter(e => e[0] === 'generate').length, 1);
  assert.equal(h.events.find(e => e[0] === 'persist')[1], 'audit');
});

test('review and archive failures keep the current workspace without false success', async () => {
  for (const stage of ['audit', 'archive']) {
    const h = stageHarness(stage, { persistStage: async () => false });
    await h.run();
    assert.ok(!h.events.some(e => ['stage', 'success', 'generate'].includes(e[0])));
  }
  const h = stageHarness('audit');
  await h.run();
  assert.deepEqual(h.events.find(e => e[0] === 'persist'), ['persist', 'archive', '待归档']);
  assert.ok(!h.events.some(e => e[0] === 'generate'));
});

test('a failed create preserves the draft and does not invent a meeting', async () => {
  const code = source.slice(source.indexOf('  const createMeeting ='), source.indexOf('  const openNewMeetingDraft ='));
  const changes = [];
  const context = {
    creatingMeetingRef: { current: false }, meetingDate: '2026-09-16T10:00', meetingTitle: 'Test',
    selectedIssueCards: [], manualAgendaItems: [], isQuickMeeting: false, agendaTitle: 'Test agenda',
    meetingDurationMinutes: 60, selectedAgendaTitle: '', projectName: '', projectCode: '', meetingOrg: '普通企业会议',
    meetingNo: '', meetingMode: 'normal', chatMessages: [], createLocalMeetingId: () => 'test-meeting',
    setCreatingMeeting: v => changes.push(['creating', v]),
    authFetchJson: async () => { throw new Error('Network unavailable'); },
    setMeetingCreated: v => changes.push(['created', v]), setActiveStage: v => changes.push(['stage', v]),
    setCurrentMeetingId: v => changes.push(['id', v]), setMeetingRecords: () => changes.push(['fake']),
    message: { error: text => changes.push(['error', text]), warning: text => changes.push(['warning', text]) },
  };
  await vm.runInNewContext(`${code}; createMeeting`, context)();
  assert.ok(changes.some(e => e[0] === 'error' && e[1].includes('Network unavailable')));
  assert.ok(!changes.some(e => ['created', 'stage', 'id', 'fake'].includes(e[0])));
  assert.equal(context.creatingMeetingRef.current, false);
});

test('draft save preserves typed content and agendas, and stays open on failure', async () => {
  const code = source.slice(source.indexOf('  const saveDraftAndExit ='), source.indexOf('  const discardAndExit ='));
  for (const fail of [true, false]) {
    const events = [];
    let payload;
    const context = {
      savingDraft: false, setSavingDraft: v => events.push(['busy', v]), currentMeetingId: 'draft-test',
      meetingTitle: 'Draft', agendaTitle: '', projectName: '', projectCode: '', meetingDate: '2026-09-16',
      meetingOrg: '普通企业会议', meetingMode: 'normal', chatMessages: [], chatInput: 'Unsubmitted notes',
      currentUserName: 'test', selectedIssueCards: [], manualAgendaItems: [{ id: 'manual', title: 'Added agenda' }],
      newAgendaInput: 'Typed agenda',
      authFetchJson: async (_url, options) => { payload = JSON.parse(options.body); if (fail) throw new Error('offline'); },
      loadMeetings: async () => {}, message: { success: () => {}, warning: () => {} },
      setShowExitConfirm: v => events.push(['dialog', v]), setMeetingWorkspaceOpen: v => events.push(['workspace', v]),
      setTimeout: fn => fn(),
    };
    await vm.runInNewContext(`${code}; saveDraftAndExit`, context)();
    assert.equal(payload.issueSources[0].content, 'Unsubmitted notes');
    assert.deepEqual(payload.agendaDrafts.map(a => a.title), ['Added agenda', 'Typed agenda']);
    assert.equal(events.some(e => e[0] === 'workspace'), !fail);
  }
});

test('a late snapshot from the previous meeting cannot overwrite the open meeting', async () => {
  const code = source.slice(source.indexOf('  const loadGeneratedMeetingRecords ='), source.indexOf('  const generateMeetingRecords ='));
  const events = [];
  let finish;
  const context = {
    currentMeetingId: 'meeting-a', activeMeetingIdRef: { current: 'meeting-a' }, snapshotRequestRef: { current: 0 },
    setMeetingRecordsLoading: v => events.push(['loading', v]),
    setRecordSnapshotState: v => events.push(['snapshot', v]),
    setMeetingGeneratedRecords: v => events.push(['records', v]), setPendingMeetingRecords: () => {},
    authFetchJson: () => new Promise(resolve => { finish = resolve; }), message: { error: () => {} },
  };
  const load = vm.runInNewContext(`${code}; loadGeneratedMeetingRecords`, context);
  const request = load();
  context.activeMeetingIdRef.current = 'meeting-b';
  finish({ records: { generated: true, title: 'meeting-a' } });
  assert.equal(await request, null);
  assert.ok(!events.some(e => e[0] === 'records' || e[0] === 'snapshot'));
});
