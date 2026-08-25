from pathlib import Path

from backend.services import meeting_review_service as service


def test_extract_json_object_accepts_fenced_json():
    assert service._extract_json_object('```json\n{"todos": []}\n```') == {"todos": []}


def test_normalise_realtime_todos_deduplicates_and_fills_owner():
    rows = service._normalise_realtime_todos(
        {
            "todos": [
                {"task": "补充预算材料", "owner": "", "priority": "未知"},
                {"task": "补充预算材料", "owner": "李四", "priority": "高"},
                {"task": "确认审批路径", "owner": "王五", "priority": "高"},
            ]
        }
    )
    assert rows == [
        {"task": "补充预算材料", "owner": "待确认", "priority": "中"},
        {"task": "确认审批路径", "owner": "王五", "priority": "高"},
    ]


def test_list_whisper_reviews_preserves_legacy_fields(monkeypatch):
    monkeypatch.setattr(
        service,
        "_meeting_for_user",
        lambda meeting_id, user: ("m1", {"generatedRecords": {"whisperDocx": {"status": "generating"}}}),
    )
    monkeypatch.setattr(
        service,
        "_db_load_transcripts_for_meeting",
        lambda meeting_id: {
            "events": [
                {
                    "id": "w1",
                    "type": "transcript",
                    "action": "whisper-review",
                    "text": "完整文本",
                    "segments": [{"id": "s1"}],
                    "model": "faster-whisper-large-v3",
                    "sourceFiles": 2,
                },
                {"type": "session", "action": "start"},
            ]
        },
    )
    result = service.list_whisper_reviews("m1", {"username": "admin"})
    assert result["meetingId"] == "m1"
    assert result["whisperReview"][0]["id"] == "w1"
    assert result["whisperReview"][0]["segmentCount"] == 1
    assert result["whisperDocx"]["status"] == "generating"


def test_correct_transcript_keeps_original_and_emits_audit_event(monkeypatch):
    data = {
        "m1": {
            "transcripts": [{
                "id": "tr1",
                "username": "alice",
                "speakerName": "Alice",
                "transcript": "原始文本",
                "events": [],
            }],
            "events": [],
        }
    }
    saved = []
    activity = []
    monkeypatch.setattr(service, "_meeting_for_user", lambda meeting_id, user: ("m1", {"id": "m1"}))
    monkeypatch.setattr(service, "_load_meeting_transcripts", lambda: data)
    monkeypatch.setattr(service, "_save_meeting_transcripts", lambda value: saved.append(value))
    monkeypatch.setattr(service, "_append_meeting_activity_light", lambda meeting_id, event: activity.append((meeting_id, event)))
    monkeypatch.setattr(service, "_resolve_meeting_role", lambda user: {
        "displayName": "Alice", "username": "alice", "meetingRole": "参会代表", "seat": "移动端席位",
    })
    monkeypatch.setattr(service, "_now_text", lambda: "2026-08-24 10:00:00")

    result = service.correct_transcript(
        "m1", "tr1", "  校订后的文本 ", "data:image/png;base64,signature", "10:00", {"username": "alice"},
    )
    record = result["record"]
    assert record["originalTranscript"] == "原始文本"
    assert record["transcript"] == "校订后的文本"
    assert record["correctedTranscript"] == "校订后的文本"
    assert record["correctionSigned"] is True
    assert saved and activity[0][1]["type"] == "transcript-correction"


def test_safe_artifact_path_rejects_paths_outside_meeting_files(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(service, "MEETING_FILES_DIR", tmp_path / "meeting_files")
    root = service.MEETING_FILES_DIR.resolve()
    root.mkdir(parents=True)
    valid = root / "m1" / "formal.docx"
    valid.parent.mkdir()
    valid.write_bytes(b"docx")
    assert service._safe_artifact_path({"path": str(valid)}) == valid
    assert service._safe_artifact_path({"path": str(tmp_path / "secret.docx")}) is None
