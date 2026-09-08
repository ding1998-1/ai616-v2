export const REVIEW_FIELDS = ['minutes', 'decisions', 'risks', 'disclosures', 'todos'];

export function deriveReviewSummary(records = {}) {
  const totals = { total: 0, confirmed: 0, batchEligible: 0, manualRequired: 0, rejected: 0 };
  const byField = {};
  const manualItems = [];
  for (const field of REVIEW_FIELDS) {
    const counts = { total: 0, confirmed: 0, batchEligible: 0, manualRequired: 0, rejected: 0 };
    for (const item of records[field] || []) {
      if (!item || typeof item !== 'object') continue;
      counts.total += 1;
      totals.total += 1;
      const status = item.supportStatus || 'ai_suggested';
      const basis = item.basis || {};
      const quotes = (basis.quotes || []).filter(quote => String(quote?.text || '').trim());
      const segmentIds = (basis.sourceSegmentIds || []).filter(Boolean);
      const hasConflict = Boolean(item.evidenceConflict || item.unresolvedEvidenceConflict || basis.conflict || basis.evidenceConflict);
      const requiresManual = Boolean(
        item.reason === 'unsupported_ai_claim'
        || item.unsupportedAiClaim
        || item.requiresHumanReview
        || item.manualReviewRequired
        || item.needsReview
        || hasConflict
        || !(basis.evidenceValid && quotes.length && segmentIds.length)
      );
      let key = 'batchEligible';
      if (status === 'human_supported') key = 'confirmed';
      else if (status === 'rejected') key = 'rejected';
      else if (requiresManual) {
        key = 'manualRequired';
        manualItems.push({ id: item.id, field, item });
      }
      counts[key] += 1;
      totals[key] += 1;
    }
    byField[field] = counts;
  }
  return { ...totals, byField, manualItems };
}

export function matchesReviewFilter(item, field, filter, summary) {
  if (filter === 'all') return true;
  const status = item?.supportStatus || 'ai_suggested';
  if (filter === 'confirmed') return status === 'human_supported';
  if (filter === 'rejected') return status === 'rejected';
  if (filter === 'pending') return status === 'ai_suggested';
  if (filter === 'needs_action') {
    return (summary?.manualItems || []).some(entry => entry.field === field && entry.id === item?.id);
  }
  return true;
}
