"""Lifecycle regression with isolated storage and preserved recording gates."""

import json

import pytest

from backend.models import MeetingUpsertRequest
from backend.services import meeting_service, outcome_service, recording_service, signature_service


@pytest.mark.parametrize('meeting_type', ['普通企业会议', '快速会议'])
def test_create_record_review_download_workspace_and_archive(meeting_type, tmp_path, monkeypatch):
    meetings = {}
    for service in (meeting_service, outcome_service):
        monkeypatch.setattr(service, '_load_meetings', lambda: meetings)
        monkeypatch.setattr(service, '_save_meetings', lambda data: meetings.update(data))
        monkeypatch.setattr(service, '_check_meeting_access', lambda *_: None)
    monkeypatch.setattr(outcome_service, '_invalidate_meetings_cache', lambda: None)
    monkeypatch.setattr(outcome_service, '_save_version', lambda *args, **kwargs: None)
    monkeypatch.setattr(recording_service, 'MEETING_FILES_DIR', tmp_path)
    signed = False
    monkeypatch.setattr(signature_service, 'is_fully_signed', lambda _: signed)
    monkeypatch.setattr(signature_service, 'signed_signer_count', lambda _: int(signed))
    monkeypatch.setattr(signature_service, 'required_signer_count', lambda _: 1)
    user = {'role': 'admin', 'username': 'test-operator'}
    meeting, _ = meeting_service.upsert_meeting(MeetingUpsertRequest(
        id='lifecycle-test', title='Lifecycle acceptance', type=meeting_type,
        phase='会前确认', agendaDrafts=[],
    ), user)
    assert meeting['phase'] == '会前确认'
    meeting_service.update_stage(meeting['id'], 'meeting', '会中记录', user)
    assert meeting['agendaFrozen']
    directory = tmp_path / 'recordings' / meeting['id']
    directory.mkdir(parents=True)
    audio = directory / 'chunk.webm'
    audio.write_bytes(b'fixture audio evidence')
    manifest = directory / 'recording_session.manifest.json'
    manifest.write_text(json.dumps({'chunks': {'0': {}}, 'finalized': False}))
    with pytest.raises(ValueError, match='尚未保存完成'):
        meeting_service.update_stage(meeting['id'], 'audit', '会后终审', user)
    assert meeting['phase'] == '会中记录'
    manifest.write_text(json.dumps({'chunks': {'0': {}}, 'finalized': True, 'outputFile': 'chunk.webm'}))
    meeting_service.update_stage(meeting['id'], 'audit', '会后终审', user)
    with pytest.raises(ValueError, match='请先确认纪要'):
        meeting_service.update_stage(meeting['id'], 'archive', '待归档', user)
    # Substitute only the external AI output; run actual review and phase logic.
    meeting['generatedRecords'] = {'generated': True, 'minutes': [{
        'agenda': 'Test agenda', 'keyPoints': [],
        'basis': {'evidenceValid': True, 'sourceSegmentIds': ['seg-1'], 'quotes': [{'text': 'Test discussion'}]},
    }]}
    outcome_service.batch_support_eligible_records(meeting['id'], user)
    outcome_service.confirm_records(meeting['id'], user)
    assert meeting['reviewDone'] and meeting['phase'] == '会后终审'
    meeting_service.update_stage(meeting['id'], 'archive', '待归档', user)
    assert not meeting['archiveDone']
    assert meeting['generatedRecords']['proofreadPassed']
    with pytest.raises(ValueError, match='尚未全员签字'):
        meeting_service.update_stage(meeting['id'], 'archive', '已归档', user)
    assert meeting['phase'] == '待归档' and not meeting['archiveDone']
    # Late confirmation from another tab must not return to the audit screen.
    outcome_service.confirm_records(meeting['id'], user)
    assert meeting['phase'] == '待归档'
    signed = True
    meeting_service.update_stage(meeting['id'], 'archive', '已归档', user)
    assert meeting['archiveDone']
    outcome_service.confirm_records(meeting['id'], user)
    meeting_service.update_stage(meeting['id'], 'audit', '会后终审', user)
    assert meeting['phase'] == '已归档' and meeting['archiveDone']
    assert audio.read_bytes() == b'fixture audio evidence'
