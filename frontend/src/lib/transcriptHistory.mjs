// The API pages backwards from the newest record. Keep history by record ID;
// identical words at different times are separate utterances.
export function mergeTranscripts(previous, incoming) {
  const records = new Map(previous.map(record => [record.id, record]));
  for (const record of incoming) {
    records.set(record.id, { ...records.get(record.id), ...record });
  }
  return [...records.values()].sort((a, b) =>
    String(a.serverTime || a.clientTime || '').localeCompare(String(b.serverTime || b.clientTime || '')),
  );
}

export async function loadTranscriptHistory(fetchPage, knownIds = new Set()) {
  const latest = await fetchPage(0);
  let records = latest.transcripts || [];
  const covered = new Set([...knownIds, ...records.map(record => record.id)]);
  let total = latest.totalTranscripts ?? records.length;
  let offset = records.length;
  while (covered.size < total && offset > 0) {
    const page = await fetchPage(offset);
    const older = page.transcripts || [];
    if (!older.length) break;
    total = Math.max(total, page.totalTranscripts || 0);
    offset += older.length;
    for (const record of older) covered.add(record.id);
    // Prefer the newest response for overlapping IDs while the meeting grows.
    records = mergeTranscripts(older, records);
  }
  return { ...latest, transcripts: records, totalTranscripts: total };
}
