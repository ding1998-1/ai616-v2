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


def test_admin_can_force_stage_transition_without_mutating_pending_recording(tmp_path, monkeypatch):
    from backend.services import meeting_service

    monkeypatch.setattr(recording_service, 'MEETING_FILES_DIR', tmp_path)
    directory = tmp_path / 'recordings' / 'meeting'
    directory.mkdir(parents=True)
    chunk = directory / 'chunk.webm'
    chunk.write_bytes(b'pending audio evidence')
    manifest = directory / 'recording_session.manifest.json'
    manifest.write_text(json.dumps({
        'sessionId': 'session', 'clientId': 'phone-1', 'userId': 'participant-1',
        'chunks': {'0': {'fileName': chunk.name}}, 'finalized': False,
    }))
    meeting = {'id': 'meeting', 'phase': '会中记录', 'events': []}
    monkeypatch.setattr(meeting_service, '_load_meetings', lambda: {'meeting': meeting})
    monkeypatch.setattr(meeting_service, '_save_meetings', lambda _: None)
    monkeypatch.setattr(meeting_service, '_check_meeting_access', lambda *_: None)

    updated = meeting_service.update_stage(
        'meeting', 'audit', '会后终审', {'role': 'admin', 'username': 'admin'},
        '管理员已核对已保存录音，同意强制结束会议', True,
    )

    assert updated['phase'] == '会后终审'
    assert updated['events'][-1]['recordingOverride']['pendingCount'] == 1
    assert updated['events'][-1]['recordingOverride']['sessions'][0]['clientId'] == 'phone-1'
    assert chunk.read_bytes() == b'pending audio evidence'


def test_non_admin_cannot_force_incomplete_recording(tmp_path, monkeypatch):
    from backend.services import meeting_service

    monkeypatch.setattr(recording_service, 'MEETING_FILES_DIR', tmp_path)
    directory = tmp_path / 'recordings' / 'meeting'
    directory.mkdir(parents=True)
    (directory / 'recording_session.manifest.json').write_text(json.dumps({
        'chunks': {'0': {}}, 'finalized': False,
    }))
    meeting = {'id': 'meeting', 'phase': '会中记录'}
    monkeypatch.setattr(meeting_service, '_load_meetings', lambda: {'meeting': meeting})
    monkeypatch.setattr(meeting_service, '_check_meeting_access', lambda *_: None)

    with pytest.raises(PermissionError, match='仅系统管理员'):
        meeting_service.update_stage(
            'meeting', 'audit', '会后终审', {'role': 'participant'},
            '普通参会人尝试强制结束会议', True,
        )
    assert meeting['phase'] == '会中记录'


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
