import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveReviewSummary, matchesReviewFilter } from './recordReview.mjs';

const validBasis = { evidenceValid: true, sourceSegmentIds: ['s1'], quotes: [{ text: '原始发言' }] };

test('review summary separates ordinary confirmation from manual exceptions', () => {
  const records = {
    minutes: [{ id: 'normal', supportStatus: 'ai_suggested', basis: validBasis }],
    decisions: [{ id: 'confirmed', supportStatus: 'human_supported', basis: validBasis }],
    risks: [{ id: 'exception', supportStatus: 'ai_suggested', reason: 'unsupported_ai_claim', basis: validBasis }],
    todos: [{ id: 'rejected', supportStatus: 'rejected', basis: {} }],
  };
  const summary = deriveReviewSummary(records);
  assert.deepEqual(
    { total: summary.total, confirmed: summary.confirmed, batchEligible: summary.batchEligible, manualRequired: summary.manualRequired, rejected: summary.rejected },
    { total: 4, confirmed: 1, batchEligible: 1, manualRequired: 1, rejected: 1 },
  );
  assert.equal(matchesReviewFilter(records.risks[0], 'risks', 'needs_action', summary), true);
  assert.equal(matchesReviewFilter(records.minutes[0], 'minutes', 'needs_action', summary), false);
});
