import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTranscriptHistory, mergeTranscripts } from './transcriptHistory.mjs';

const records = count => Array.from({ length: count }, (_, index) => ({
  id: `record-${index}`, transcript: 'Repeated utterance',
  serverTime: new Date(2026, 8, 7, 10, 0, index).toISOString(),
}));
const pageOf = (rows, offset) => ({
  transcripts: rows.slice(Math.max(0, rows.length - offset - 1000), rows.length - offset),
  totalTranscripts: rows.length,
});

test('loads a 2505-record meeting across all API pages', async () => {
  const rows = records(2505);
  const offsets = [];
  const result = await loadTranscriptHistory(async offset => {
    offsets.push(offset);
    return pageOf(rows, offset);
  });
  assert.deepEqual(offsets, [0, 1000, 2000]);
  assert.equal(result.transcripts.length, 2505);
  assert.equal(new Set(result.transcripts.map(row => row.id)).size, 2505);
  assert.ok(result.transcripts.some(row => row.id === 'record-0'));
});

test('polls only the latest page after history is loaded and retains all rows', async () => {
  const previous = records(2505);
  const rows = records(2510);
  const offsets = [];
  const result = await loadTranscriptHistory(async offset => {
    offsets.push(offset);
    return pageOf(rows, offset);
  }, new Set(previous.map(row => row.id)));
  assert.deepEqual(offsets, [0]);
  assert.equal(mergeTranscripts(previous, result.transcripts).length, 2510);
});

test('fills a gap larger than one page after reconnecting', async () => {
  const previous = records(50);
  const result = await loadTranscriptHistory(async offset => pageOf(records(2300), offset), new Set(previous.map(row => row.id)));
  assert.equal(mergeTranscripts(previous, result.transcripts).length, 2300);
});

test('preserves repeated words with distinct IDs and updates the same ID', () => {
  const previous = records(40);
  const result = mergeTranscripts(previous, [{ ...previous[0], transcript: 'Corrected text' }, previous[1]]);
  assert.equal(result.length, 40);
  assert.equal(result.find(row => row.id === previous[0].id).transcript, 'Corrected text');
});

test('handles page overlap when speech arrives during history loading', async () => {
  let rows = records(2050);
  const result = await loadTranscriptHistory(async offset => {
    if (offset === 1000) rows = records(2051);
    return pageOf(rows, offset);
  });
  assert.equal(new Set(result.transcripts.map(row => row.id)).size, 2050);
  assert.ok(result.transcripts.some(row => row.id === 'record-0'));
});

test('does not silently accept a failed history page', async () => {
  await assert.rejects(loadTranscriptHistory(async offset => {
    if (offset) throw new Error('Network unavailable');
    return pageOf(records(1500), 0);
  }), /Network unavailable/);
});
