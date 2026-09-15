export function desktopDurationSeconds(startedAt, stoppedAt) {
  if (!Number.isFinite(startedAt) || !Number.isFinite(stoppedAt) || startedAt <= 0) return 0;
  return Math.max(1, Math.ceil((stoppedAt - startedAt) / 1000));
}

export function desktopSpeakerIdentity(quick, userName, userRole, voiceprint = {}) {
  if (quick) return { speaker_name: '现场发言', speaker_role: '待确认发言人', identified_by: 'unassigned', speaker_confidence: 0 };
  return {
    speaker_name: voiceprint.speaker_name || userName,
    speaker_role: userRole,
    identified_by: voiceprint.identified_by || 'manual',
    speaker_confidence: voiceprint.speaker_confidence || 0,
  };
}

export function desktopTranscriptLabel(quick, item) {
  const unassigned = quick && !item.audioClientId && !item.speakerCorrected && !item.correctionSigned;
  return unassigned ? { speaker: '现场发言', role: '待确认发言人' } : { speaker: item.speakerName, role: item.speakerRole };
}
