import asyncio
import pytest

from backend.services.meeting_record_cleanup_service import (
    MAX_OUTPUT_PARAGRAPH_CHARS,
    MeetingRecordCleanupService,
    build_cleanup_chunks,
    reuse_existing_topics,
    validate_topic_reduce_result,
    validate_cleanup_result,
)


def _rows(count=7, step=30):
    return [
        {
            "segmentId": f"s{index}",
            "fileId": "audio-1",
            "start": index * step,
            "end": index * step + 5,
            "speaker": "说话人未识别",
            "text": f"第{index}段有效会议发言",
        }
        for index in range(count)
    ]


def test_cleanup_chunks_never_span_three_minutes_for_unknown_speakers():
    chunks = build_cleanup_chunks(_rows())
    assert len(chunks) == 2
    assert all((chunk.end or 0) - (chunk.start or 0) < 180 for chunk in chunks)
    assert sum(len(chunk.segments) for chunk in chunks) == 7


def test_media_boundary_forces_a_new_chunk():
    rows = _rows(3, 10)
    rows[1]["text"] = "请点赞订阅转发，感谢观看"
    chunks = build_cleanup_chunks(rows)
    assert [len(chunk.segments) for chunk in chunks] == [1, 1, 1]


def test_validation_rejects_foreign_ids_and_neutralizes_unsupported_decision():
    chunk = build_cleanup_chunks(_rows(2, 10))[0]
    with pytest.raises(ValueError, match="upgraded discussion"):
        validate_cleanup_result({
            "blocks": [{
            "topic": "数据讨论",
            "recordText": "会议决定由张三完成数据整理。",
            "contentType": "meeting_speech",
            "sourceSegmentIds": ["s0", "foreign"],
            }],
        }, chunk)


def test_validation_forces_promotional_copy_out_of_participant_speech():
    rows = [{
        "segmentId": "media-1",
        "fileId": "audio-1",
        "start": 10,
        "end": 15,
        "speaker": "说话人未识别",
        "text": "请点赞订阅转发，感谢观看",
    }]
    chunk = build_cleanup_chunks(rows)[0]
    result = validate_cleanup_result({
        "records": [{
            "topic": "现场播放内容",
            "recordText": "请点赞、订阅、转发支持本栏目。",
            "contentType": "speech",
            "sourceSegmentIds": ["media-1"],
        }],
    }, chunk)
    assert result[0]["contentType"] == "background_media"
    assert result[0]["includeInRecord"] is False


def test_video_audio_is_background_evidence_not_live_presentation():
    rows = [{
        "segmentId": "video-1", "fileId": "audio-1", "start": 10, "end": 15,
        "speaker": "说话人未识别", "text": "我们这个和谐小区的视频",
    }, {
        "segmentId": "video-2", "fileId": "audio-1", "start": 15, "end": 20,
        "speaker": "说话人未识别", "text": "公共收益小区平台",
    }]
    chunk = build_cleanup_chunks(rows)[0]
    result = validate_cleanup_result({"blocks": [{
        "title": "平台视频",
        "recordText": "现场展示了公共收益平台及多项功能。",
        "contentType": "presentation",
        "informationValue": "high",
        "quality": "medium",
        "statementType": "fact",
        "modality": "discussed",
        "sourceSegmentIds": ["video-1", "video-2"],
    }]}, chunk)
    assert result[0]["contentType"] == "background_media"
    assert result[0]["recordText"] == ""
    assert result[0]["includeInRecord"] is False


def test_reasoning_pollution_is_rejected_instead_of_string_deleted():
    chunk = build_cleanup_chunks(_rows(1))[0]
    with pytest.raises(ValueError, match="AI review reasoning"):
        validate_cleanup_result({"blocks": [{
            "title": "数据调整",
            "recordText": "结合上下文，原文误识的内容可能指数据调整。",
            "reviewNotes": [],
            "contentType": "meeting_speech",
            "informationValue": "medium",
            "quality": "medium",
            "statementType": "discussion",
            "modality": "discussed",
            "includeInRecord": True,
            "sourceSegmentIds": ["s0"],
        }]}, chunk)


def test_low_quality_unclear_block_is_kept_for_audit_but_not_word():
    chunk = build_cleanup_chunks(_rows(1))[0]
    result = validate_cleanup_result({"blocks": [{
        "title": "听辨不清内容",
        "recordText": "[听辨不清][听辨不清]",
        "reviewNotes": [],
        "contentType": "uncertain",
        "informationValue": "low",
        "quality": "low",
        "statementType": "uncertain",
        "modality": "uncertain",
        "includeInRecord": True,
        "sourceSegmentIds": ["s0"],
    }]}, chunk)
    assert result[0]["includeInRecord"] is False
    assert result[0]["recordText"] == ""
    assert result[0]["reviewNotes"]


def test_topic_reduce_covers_every_included_block_once():
    blocks = [
        {"id": "r1", "title": "合同数据", "startTime": "00:00:00", "endTime": "00:01:00", "recordText": "会议讨论合同数据整理。", "includeInRecord": True},
        {"id": "r2", "title": "价格分类", "startTime": "00:01:00", "endTime": "00:02:00", "recordText": "会议讨论价格分类。", "includeInRecord": True},
    ]
    topics = validate_topic_reduce_result({"topics": [{
        "title": "合同数据整理与分类", "blockIds": ["r1", "r2"],
        "subTopics": [{"title": "数据整理", "blockIds": ["r1"]}, {"title": "价格分类", "blockIds": ["r2"]}],
    }]}, blocks)
    assert topics[0]["blockIds"] == ["r1", "r2"]


def test_existing_topic_outline_is_remapped_when_block_ids_change():
    blocks = [
        {"id": "new-1", "title": "合同数据", "startTime": "00:00:00", "endTime": "00:01:00", "recordText": "会议讨论合同数据整理。", "includeInRecord": True},
        {"id": "new-2", "title": "价格分类", "startTime": "00:01:00", "endTime": "00:02:00", "recordText": "会议讨论价格分类。", "includeInRecord": True},
        {"id": "new-3", "title": "支付流程", "startTime": "00:02:00", "endTime": "00:03:00", "recordText": "会议讨论支付流程。", "includeInRecord": True},
    ]
    existing_topics = [
        {"title": "合同数据整理与分类", "startTime": "00:00:00", "blockIds": ["old-1", "old-2"]},
        {"title": "支付流程", "startTime": "00:02:00", "blockIds": ["old-3"]},
    ]
    topics = reuse_existing_topics(existing_topics, blocks)
    assert [item["title"] for item in topics] == ["合同数据整理与分类", "支付流程"]
    assert [item["blockIds"] for item in topics] == [["new-1", "new-2"], ["new-3"]]


def test_cached_promotional_copy_is_reclassified_without_an_ai_call():
    async def must_not_run(_prompt):
        raise AssertionError("cache should be reused")

    rows = [{
        "segmentId": "media-1", "fileId": "audio-1", "start": 10, "end": 15,
        "speaker": "说话人未识别", "text": "请点赞订阅转发，感谢观看",
    }]
    chunk = build_cleanup_chunks(rows)[0]
    cached = [{
        "id": "cached-media", "topic": "现场播放内容",
        "startTime": "00:00:10", "endTime": "00:00:15",
        "speaker": "说话人未识别", "recordText": "请点赞、订阅、转发支持本栏目。",
        "contentType": "speech", "sourceSegmentIds": ["media-1"],
        "sourceFileIds": ["audio-1"], "inputHash": chunk.input_hash,
        "promptVersion": "meeting-record-cleanup-v2.3",
    }]
    result = asyncio.run(MeetingRecordCleanupService(cleanup_call=must_not_run).build_record_paragraphs(rows, existing=cached))
    assert result["recordParagraphs"][0]["contentType"] == "background_media"


def test_cleanup_failure_does_not_fall_back_to_raw_asr():
    async def broken(_prompt):
        raise RuntimeError("offline")

    result = asyncio.run(MeetingRecordCleanupService(cleanup_call=broken).build_record_paragraphs(_rows(2)))
    paragraph = result["recordParagraphs"][0]
    assert paragraph["cleanupFailed"] is True
    assert "第0段有效会议发言" not in paragraph["recordText"]
    assert paragraph["sourceSegmentIds"] == ["s0", "s1"]


def test_output_paragraphs_are_capped_and_locked_items_survive_rerun():
    async def handler(_prompt):
        return {"records": [{
            "topic": "长段",
            "recordText": "内容。" * 500,
            "contentType": "speech",
            "sourceSegmentIds": ["s0"],
        }]}

    locked = [{
        "id": "human-1", "topic": "人工段", "recordText": "人工内容",
        "contentType": "speech", "sourceSegmentIds": ["s1"], "locked": True,
        "startTime": "00:00:10", "endTime": "00:00:15",
    }]
    result = asyncio.run(MeetingRecordCleanupService(cleanup_call=handler).build_record_paragraphs(_rows(2, 10), existing=locked))
    assert any(item["id"] == "human-1" for item in result["recordParagraphs"])
    assert all(len(item["recordText"]) <= MAX_OUTPUT_PARAGRAPH_CHARS for item in result["recordParagraphs"])


def test_empty_model_output_for_short_fragment_becomes_traceable_noise():
    async def handler(_prompt):
        return {"records": []}

    rows = [{"segmentId": "short-1", "start": 1, "end": 1.6, "text": "刚好"}]
    result = asyncio.run(MeetingRecordCleanupService(cleanup_call=handler).build_record_paragraphs(rows))
    paragraph = result["recordParagraphs"][0]
    assert paragraph["contentType"] == "noise"
    assert paragraph["sourceSegmentIds"] == ["short-1"]
    assert not paragraph.get("cleanupFailed")
