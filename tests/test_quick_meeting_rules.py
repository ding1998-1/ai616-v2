import asyncio
from copy import deepcopy
import pytest
from fastapi import HTTPException
from backend.models import MeetingUpsertRequest, MeetingRecorderSessionRequest
from backend.services import meeting_service
from backend.routes import recordings


def test_quick_creation_preserves_empty_agendas(monkeypatch):
    saved = {}
    monkeypatch.setattr(meeting_service, '_load_meetings', lambda: {})
    monkeypatch.setattr(meeting_service, '_save_meetings', lambda data: saved.update(data))
    body = MeetingUpsertRequest(id='meeting-quick', title='Quick', type='快速会议', agendaDrafts=[])
    meeting, existed = meeting_service.upsert_meeting(body, {'username': 'tester'})
    assert not existed
    assert meeting['agendaDrafts'] == []
    assert meeting['agenda'] == ''
    assert meeting['meetingMode'] == 'normal'


def test_existing_type_cannot_be_converted_to_quick(monkeypatch):
    meeting = {'id': 'meeting-old', 'type': '普通企业会议'}
    monkeypatch.setattr(meeting_service, '_load_meetings', lambda: {'meeting-old': meeting})
    monkeypatch.setattr(meeting_service, '_check_meeting_access', lambda *_: None)
    with pytest.raises(PermissionError):
        meeting_service.patch_meeting('meeting-old', {'type': '快速会议'}, {'role': 'admin'})
    assert meeting['type'] == '普通企业会议'


def test_quick_mobile_start_is_rejected_before_registration(monkeypatch):
    monkeypatch.setattr(recordings, 'require_meeting', lambda *_: ({'role': 'admin'}, 'meeting-quick', {'type': '快速会议'}))
    monkeypatch.setattr(recordings, '_resolve_meeting_role', lambda *_: 'admin')
    def forbidden(*_):
        raise AssertionError('Must not register mobile client')
    monkeypatch.setattr(recordings, '_db_upsert_audio_client', forbidden)
    body = MeetingRecorderSessionRequest(meeting_id='meeting-quick', action='start', device_id='phone')
    with pytest.raises(HTTPException) as exc:
        asyncio.run(recordings.recorder_session(None, body))
    assert exc.value.status_code == 409


def test_repeated_end_does_not_write_or_reopen_archive(monkeypatch):
    meeting = {'id': 'meeting-ended', 'phase': '已归档', 'archiveDone': True}
    before = deepcopy(meeting)
    monkeypatch.setattr(meeting_service, '_load_meetings', lambda: {'meeting-ended': meeting})
    monkeypatch.setattr(meeting_service, '_check_meeting_access', lambda *_: None)
    def forbidden(*_):
        raise AssertionError('Repeated end must not write')
    monkeypatch.setattr(meeting_service, '_save_meetings', forbidden)
    assert meeting_service.update_stage('meeting-ended', 'audit', '会后终审', {}) == before
    assert meeting == before


@pytest.mark.parametrize('action', ['start', 'join', 'resume'])
def test_ordinary_mobile_sessions_keep_existing_registration(action, monkeypatch):
    registrations, events = [], []
    monkeypatch.setattr(recordings, 'require_meeting', lambda *_: ({'role': 'admin'}, 'meeting-ordinary', {'type': '普通企业会议'}))
    monkeypatch.setattr(recordings, '_resolve_meeting_role', lambda *_: 'admin')
    monkeypatch.setattr(recordings, '_db_upsert_audio_client', lambda *args: registrations.append(args))
    monkeypatch.setattr(recordings, '_append_meeting_activity_light', lambda mid, event: events.append(event))
    async def publish(*_args):
        return None
    monkeypatch.setattr(recordings.sse_manager, 'publish', publish)
    body = MeetingRecorderSessionRequest(meeting_id='meeting-ordinary', action=action, device_id='phone')
    asyncio.run(recordings.recorder_session(None, body))
    assert len(registrations) == 1
    assert events[0]['action'] == action


def test_quick_legacy_mobile_stop_is_not_blocked(monkeypatch):
    events = []
    monkeypatch.setattr(recordings, 'require_meeting', lambda *_: ({'role': 'admin'}, 'meeting-quick', {'type': '快速会议'}))
    monkeypatch.setattr(recordings, '_resolve_meeting_role', lambda *_: 'admin')
    monkeypatch.setattr(recordings, '_append_meeting_activity_light', lambda mid, event: events.append(event))
    async def publish(*_args):
        return None
    monkeypatch.setattr(recordings.sse_manager, 'publish', publish)
    body = MeetingRecorderSessionRequest(meeting_id='meeting-quick', action='stop', device_id='existing-phone')
    asyncio.run(recordings.recorder_session(None, body))
    assert events[0]['action'] == 'stop'


def test_quick_empty_agenda_count_does_not_invent_an_issue():
    from backend.db import _normalize_meeting
    assert _normalize_meeting({'type': '快速会议', 'agendaDrafts': [], 'issueSources': []})['issueCount'] == 0
    assert _normalize_meeting({'type': '普通企业会议', 'agendaDrafts': [], 'issueSources': []})['issueCount'] == 1
