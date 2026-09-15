import test from 'node:test';
import assert from 'node:assert/strict';
import { desktopDurationSeconds, desktopSpeakerIdentity } from './desktopRecording.mjs';

test('capture duration stays fixed during save retries and excludes meeting history', () => {
  const started = Date.parse('2026-09-15T14:58:05+08:00');
  const stopped = started + 58200;
  assert.equal(desktopDurationSeconds(started, stopped), 59);
  assert.equal(desktopDurationSeconds(null, stopped), 0);
});
test('quick room audio is never attributed to the operator or a guessed voiceprint', () => {
  assert.deepEqual(desktopSpeakerIdentity(true, 'Operator', 'Admin', { speaker_name: 'Candidate' }), {
    speaker_name: '现场发言', speaker_role: '待确认发言人', identified_by: 'unassigned', speaker_confidence: 0,
  });
});
test('ordinary desktop speaker identity remains compatible', () => {
  assert.equal(desktopSpeakerIdentity(false, 'Operator', 'Admin').speaker_name, 'Operator');
  assert.equal(desktopSpeakerIdentity(false, 'Operator', 'Admin', { speaker_name: 'Confirmed' }).speaker_name, 'Confirmed');
});

test('legacy quick speech is anonymous in view while corrected and H5 identity is preserved', async () => {
  const { desktopTranscriptLabel } = await import('./desktopRecording.mjs');
  const old = { speakerName:'Operator', speakerRole:'Admin' };
  assert.equal(desktopTranscriptLabel(true,old).speaker,'现场发言');
  assert.equal(desktopTranscriptLabel(false,old).speaker,'Operator');
  assert.equal(desktopTranscriptLabel(true,{...old,audioClientId:'phone'}).speaker,'Operator');
  assert.equal(desktopTranscriptLabel(true,{...old,speakerCorrected:true}).speaker,'Operator');
  assert.equal(old.speakerName,'Operator');
});
