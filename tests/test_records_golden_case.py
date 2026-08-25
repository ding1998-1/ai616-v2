"""Offline regression checks for the 2026-08-19 Yuezhong Golden Case.

The raw payload is intentionally local-only because it contains business
meeting content.  CI and clean checkouts run the manifest-only check and skip
the data-dependent checks with an explicit message until the fixture is
provided locally.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import pytest

from backend.services.meeting_record_generation_service import (
    MeetingRecordGenerationService,
    chunk_transcript_segments,
    normalise_transcript_segments,
)


FIXTURE_DIR = Path(__file__).parent / "fixtures" / "2026-08-19-yuezhong"
MANIFEST_PATH = FIXTURE_DIR / "manifest.json"


def _manifest() -> dict[str, Any]:
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def _payload(name: str) -> dict[str, Any]:
    path = FIXTURE_DIR / name
    if not path.exists():
        pytest.skip(
            f"Golden Case 原始 payload 未提供：{path}; "
            "请按 fixture README 重新执行只读导出"
        )
    return json.loads(path.read_text(encoding="utf-8"))


def test_manifest_is_redacted_and_points_to_expected_case() -> None:
    manifest = _manifest()
    assert manifest["case"] == "2026-08-19-yuezhong"
    assert manifest["meetingId"] == "meeting-local-20260819131104"
    assert manifest["title"] == "悦仲业务二部周例会"
    assert manifest["date"] == "2026-08-19"
    serialised = json.dumps(manifest, ensure_ascii=False).lower()
    assert "authorization" not in serialised
    assert "bearer " not in serialised
    assert "password" not in serialised
    assert "token" not in serialised


def test_golden_case_source_is_complete_and_not_sampled() -> None:
    manifest = _manifest()
    transcripts = _payload("transcripts.json")
    meeting = _payload("meeting.json")["meeting"]
    records = _payload("records.json")["records"]

    rows = transcripts["transcripts"]
    assert len(rows) == manifest["counts"]["transcripts"] == 721
    assert transcripts["totalTranscripts"] == 721
    assert len({row["id"] for row in rows}) == 721
    assert all(str(row.get("transcript") or "").strip() for row in rows)

    audio_events = [event for event in meeting["events"] if event.get("type") == "audio"]
    assert len(audio_events) == manifest["counts"]["audioEvents"] == 8
    assert len(records.get("chronicle") or []) == manifest["counts"]["legacyChronicle"] == 721

    source_counts = {
        source: sum(1 for row in rows if row.get("source") == source)
        for source in {row.get("source") for row in rows}
    }
    assert source_counts == manifest["counts"]["transcriptSources"]


def test_legacy_output_records_the_known_quality_baseline() -> None:
    records = _payload("records.json")["records"]
    chronicle = records.get("chronicle") or []
    assert any(item.get("speaker") == "Whisper 终审" for item in chronicle)
    assert records.get("transcriptCount") == 721
    assert records.get("audioCount") == 8

    # The old output is the comparison baseline: no basis is attached to the
    # minutes/decisions and at least one owner is not a participant identity.
    assert records.get("minutes")
    assert records.get("decisions")
    assert all("basis" not in item for item in records["minutes"])
    assert all("basis" not in item for item in records["decisions"])
    assert any(item.get("owner") == "土弟" for item in records.get("todos") or [])


def test_v2_chunker_assigns_every_golden_transcript() -> None:
    payload = _payload("transcripts.json")
    segments = normalise_transcript_segments(payload["transcripts"])
    chunks = chunk_transcript_segments(segments)

    source_ids = {segment.id for segment in segments}
    assigned_ids = {segment.id for chunk in chunks for segment in chunk.segments}
    assert len(segments) == 721
    assert assigned_ids == source_ids
    assert all(chunk.segments for chunk in chunks)
    assert all(len(chunk.text) <= 5000 for chunk in chunks)

    # The current public API does not expose audioFileId on the 721 rows, so
    # the local normaliser falls back to one source file.  This is evidence to
    # fix in the next backend iteration, not a reason to silently sample.
    assert {segment.file_id for segment in segments} == {"file-1"}


def test_v2_fake_llm_covers_full_golden_case_without_external_calls() -> None:
    payload = _payload("transcripts.json")
    source = payload["transcripts"]
    map_calls: list[dict[str, Any]] = []
    reduce_calls: list[dict[str, Any]] = []

    async def map_call(_prompt: str, context: dict[str, Any]) -> str:
        map_calls.append(context)
        first = context["chunk"]["segments"][0]
        return json.dumps(
            {
                "chunkSummary": "offline golden fixture",
                "topics": [{"title": "fixture topic", "timeRange": first.get("timeRange", "")}],
                "conclusions": [
                    {
                        "content": "fixture conclusion",
                        "type": "知悉",
                        "evidence": first["text"],
                        "time": first.get("timeRange", ""),
                    }
                ],
                "risks_disclosures": [],
                "todos": [],
                "key_numbers": [],
                "corrections": [],
            },
            ensure_ascii=False,
        )

    async def reduce_call(_prompt: str, context: dict[str, Any]) -> str:
        reduce_calls.append(context)
        first = context["chunks"][0]["segments"][0]
        basis = {
            "timeRange": first.get("timeRange", ""),
            "quotes": [{"time": first.get("timeRange", ""), "text": first["text"]}],
        }
        return json.dumps(
            {
                "summary": {"conclusions": [], "risks": [], "todos": []},
                "minutes": [{"agenda": "fixture topic", "status": "已讨论", "keyPoints": [], "basis": basis}],
                "decisions": [{"content": "fixture conclusion", "type": "知悉", "basis": basis}],
                "risks": [],
                "disclosures": [],
                "todos": [],
            },
            ensure_ascii=False,
        )

    service = MeetingRecordGenerationService(
        map_call=map_call,
        reduce_call=reduce_call,
        concurrency=4,
        max_chars=4000,
        model_name="test-double",
    )
    records = asyncio.run(
        service.generate(
            "meeting-local-20260819131104",
            source,
            meeting_context={"title": "悦仲业务二部周例会"},
            participants=["丁志强", "王灿军"],
        )
    )

    assert records["pipelineStatus"] == "ok"
    assert records["proofreadPassed"] is True
    assert records["coverage"]["coverageRatio"] == 1.0
    assert records["coverage"]["assignedSegmentCount"] == 721
    assert records["generationSnapshot"]["chunkCount"] == len(map_calls)
    assert records["generationSnapshot"]["mapCallCount"] == len(map_calls)
    assert records["generationSnapshot"]["reduceCallCount"] == 1
    assert len(reduce_calls) == 1
    assert records["minutes"][0]["basis"]["evidenceValid"] is True
    assert records["minutes"][0]["basis"]["sourceSegmentIds"]
    assert records["decisions"][0]["basis"]["evidenceValid"] is True
