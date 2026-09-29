from backend.services.meeting_payload_service import (
    compact_meeting_detail,
    compact_records_snapshot,
)


def test_compact_meeting_detail_omits_duplicate_heavy_fields():
    meeting = {
        "id": "meeting-performance",
        "title": "性能测试会议",
        "events": [{"id": "event-1"}],
        "generatedRecords": {"minutes": [{"id": "minute-1"}]},
        "agendaDrafts": [{"id": "agenda-1", "title": "议题一"}],
        "materials": [{"id": "material-1", "name": "材料一"}],
    }

    payload = compact_meeting_detail(meeting)

    assert "generatedRecords" not in payload
    assert "events" not in payload
    assert payload["agendaDrafts"][0]["title"] == "议题一"
    assert payload["materials"][0]["name"] == "材料一"


def test_compact_record_snapshot_keeps_ui_fields_and_drops_intermediate_data():
    snapshot = {
        "meetingId": "meeting-performance",
        "records": {
            "minutes": [{"id": "minute-1"}],
            "mapResults": [{"output": {"topics": [{"title": "议题一"}]}}],
            "documents": {"minutes": {"content": "large"}},
            "_recordParagraphs": ["paragraph"],
            "recordBlocks": ["block"],
            "coverage": {
                "sourceSegmentCount": 203,
                "sourceFileCount": 1,
                "segmentEvidence": ["large"],
            },
        },
        "pendingRecords": None,
    }

    compact = compact_records_snapshot(snapshot)
    records = compact["records"]

    assert records["minutes"] == [{"id": "minute-1"}]
    assert records["hasMappedTopics"] is True
    assert records["coverage"] == {"sourceSegmentCount": 203, "sourceFileCount": 1}
    assert "mapResults" not in records
    assert "documents" not in records
    assert "_recordParagraphs" not in records
    assert "recordBlocks" not in records
