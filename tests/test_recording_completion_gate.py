import json

import pytest

from backend.services import recording_service


def test_meeting_waits_for_all_recordings_without_mutating_audio(tmp_path, monkeypatch):
    monkeypatch.setattr(recording_service, 'MEETING_FILES_DIR', tmp_path)
    directory = tmp_path / 'recordings' / 'meeting'
    directory.mkdir(parents=True)
    audio = directory / 'chunk.webm'
    audio.write_bytes(b'original audio')
    manifest = directory / 'recording_session.manifest.json'
    manifest.write_text(json.dumps({'chunks': {'0': {}}, 'finalized': False}))
    with pytest.raises(ValueError, match='尚未保存完成'):
        recording_service.require_completed_recordings('meeting')
    assert audio.read_bytes() == b'original audio'
    manifest.write_text(json.dumps({'chunks': {'0': {}}, 'finalized': True, 'outputFile': 'saved.webm'}))
    with pytest.raises(ValueError):
        recording_service.require_completed_recordings('meeting')
    (directory / 'saved.webm').write_bytes(b'complete audio')
    recording_service.require_completed_recordings('meeting')


def test_meeting_without_mobile_recordings_can_finish(tmp_path, monkeypatch):
    monkeypatch.setattr(recording_service, 'MEETING_FILES_DIR', tmp_path)
    recording_service.require_completed_recordings('meeting')
    assert list(tmp_path.iterdir()) == []


def test_rejected_stage_transition_does_not_advance_meeting(monkeypatch):
    from backend.services import meeting_service

    meeting = {'id': 'meeting', 'phase': '会中记录'}
    monkeypatch.setattr(meeting_service, '_load_meetings', lambda: {'meeting': meeting})
    monkeypatch.setattr(meeting_service, '_check_meeting_access', lambda *_: None)

    def pending(_):
        raise ValueError('Recording is incomplete')

    monkeypatch.setattr(recording_service, 'require_completed_recordings', pending)
    with pytest.raises(ValueError, match='incomplete'):
        meeting_service.update_stage('meeting', 'audit', '会后终审', {'role': 'admin'})
    assert meeting['phase'] == '会中记录'
