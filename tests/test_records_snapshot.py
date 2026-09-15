import asyncio
from copy import deepcopy

from backend.routes import outcomes
from backend.services import outcome_service


def test_snapshot_never_generates_or_writes(monkeypatch):
    meeting = {"id": "meeting-readonly", "phase": "已归档", "generatedRecords": None}
    original = deepcopy(meeting)
    monkeypatch.setattr(outcomes, "require_meeting", lambda *_: ({}, meeting["id"], meeting))
    monkeypatch.setattr(outcome_service, "_load_meetings", lambda: {meeting["id"]: meeting})

    def forbidden(*args, **kwargs):
        raise AssertionError("Snapshot must not write or generate")

    monkeypatch.setattr(outcome_service, "_save_meetings", forbidden)
    monkeypatch.setattr(outcomes, "generate_records_v2", forbidden)
    for _ in range(2):
        response = asyncio.run(outcomes.meeting_records_snapshot(None, meeting["id"]))
        assert response["records"]["generated"] is False
    assert meeting == original


def test_background_candidate_cannot_replace_human_confirmed_minutes():
    original = {'generated': True, 'summary': ['Human approved'], 'generationId': 'old'}
    meeting = {'reviewDone': True, 'generatedRecords': deepcopy(original)}
    candidate = {'generated': True, 'summary': ['New AI wording'], 'generationId': 'new'}
    result = outcome_service._store_generated_candidate(meeting, candidate)
    assert {k: v for k, v in meeting['generatedRecords'].items() if k != 'pendingGeneratedRecords'} == original
    assert meeting['generatedRecords']['pendingGeneratedRecords'] == candidate
    assert result['pendingGenerationId'] == 'new'
    assert 'pendingGenerationId' not in meeting['generatedRecords']


def test_confirmed_candidate_survives_sqlite_reload(tmp_path, monkeypatch):
    import sqlite3
    from backend import db
    connection = sqlite3.connect(tmp_path / 'records.sqlite')
    connection.row_factory = sqlite3.Row
    monkeypatch.setattr(db, '_db_connect', lambda: connection)
    db._init_app_db()
    meeting = {'id': 'meeting-persisted', 'reviewDone': True, 'generatedRecords': {'generated': True, 'summary': ['Approved']}}
    candidate = {'generated': True, 'generationId': 'candidate', 'summary': ['New result']}
    outcome_service._store_generated_candidate(meeting, candidate)
    db._db_insert_meeting_rows(connection, meeting)
    connection.commit()
    reloaded = db._db_fetch_meetings()
    monkeypatch.setattr(outcome_service, '_load_meetings', lambda: reloaded)
    snapshot = outcome_service.get_records(meeting['id'])
    assert snapshot['pendingRecords'] == candidate
    assert snapshot['records']['summary'] == ['Approved']
    assert 'pendingGeneratedRecords' not in snapshot['records']
    connection.close()
