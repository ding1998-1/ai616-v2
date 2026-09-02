from pathlib import Path

import pytest

from backend.services import meeting_document_service
from backend.services.meeting_document_service import (
    ProofreadRequiredError,
    build_evidence_manifest,
    generate_document_bundle,
    render_evidence_markdown,
    render_formal_markdown,
)


def test_formal_word_marks_authorized_human_override():
    lines = meeting_document_service._formal_record_lines({
        "minutes": [{"agenda": "预算调整", "keyPoints": []}],
        "latestFormalOverride": {
            "operator": "会议秘书",
            "time": "2026-09-02 10:00:00",
            "reason": "已核对录音原文并确认内容",
        },
    })
    text = "\n".join(line for line, _ in lines)
    assert "人工核验说明" in text
    assert "会议秘书" in text
    assert "已核对录音原文并确认内容" in text


def _records(proofread=True):
    return {
        "pipeline": "records-v2",
        "proofreadPassed": proofread,
        "generationSnapshot": {
            "provider": "local",
            "model": "qwen-test",
            "pipelineVersion": "records-v2",
            "promptVersion": "records-v2-map-reduce-v1",
            "schemaVersion": "meeting-records-v2",
            "glossaryVersion": "1",
            "chunkPolicy": "audio-file-boundary+time-4000-chars",
            "mapCallCount": 2,
            "reduceCallCount": 1,
        },
        "minutes": [{
            "agenda": "预算调整",
            "status": "已记录",
            "keyPoints": ["确认按程序补充材料"],
            "basis": {
                "timeRange": "00:01:00-00:02:00",
                "quotes": [{"text": "确认按程序补充材料", "segmentId": "s1"}],
            },
        }],
        "decisions": [{
            "content": "同意补充预算材料",
            "type": "决定",
            "status": "待确认",
            "basis": {
                "timeRange": "00:01:00-00:02:00",
                "quotes": [{"text": "确认按程序补充材料", "segmentId": "s1"}],
            },
        }],
        "risks": [{
            "content": "超过权限的支出需履行审批程序",
            "severity": "高",
            "basis": {
                "timeRange": "00:04:00-00:04:10",
                "quotes": [{"text": "需要重新履行审批程序", "segmentId": "s2"}],
            },
        }],
        "disclosures": [{
            "content": "向管理层披露预算变化",
            "audience": "管理层",
            "basis": {
                "timeRange": "00:04:00-00:04:10",
                "quotes": [{"text": "需要重新履行审批程序", "segmentId": "s2"}],
            },
        }],
        "todos": [{
            "task": "补充预算材料",
            "owner": "张三",
            "deadline": "待定",
            "basis": {
                "timeRange": "00:01:00-00:02:00",
                "quotes": [{"text": "确认按程序补充材料", "segmentId": "s1"}],
            },
        }],
        "mapResults": [{
            "chunkId": "chunk-0001",
            "fileId": "audio-1",
            "timeRange": "00:00:00-00:05:00",
            "chunkSegments": [{"segmentId": "s1"}, {"segmentId": "s2"}],
        }],
        "evidenceExceptions": [{
            "field": "decisions",
            "reason": "unsupported_ai_claim",
            "item": {"content": "没有原文支持的虚构决议"},
        }],
    }


def _chronicle():
    return [
        {"id": "s1", "fileId": "audio-1", "start": 60, "end": 120, "speaker": "张三", "text": "确认按程序补充材料"},
        {"id": "s2", "fileId": "audio-1", "start": 250, "end": 260, "speaker": "李四", "text": "需要重新履行审批程序"},
        {"id": "s3", "fileId": "audio-1", "start": 400, "end": 410, "speaker": "李四", "text": "这是一条应保留的完整原始证据长句"},
        {"id": "s4", "fileId": "audio-1", "start": 420, "end": 421, "speaker": "未知", "text": "噪音行", "isNoise": True, "noiseReason": "背景杂音"},
    ]


def test_manifest_keeps_valid_and_excluded_rows_and_marks_two_minute_gap():
    manifest = build_evidence_manifest(_records(), _chronicle())
    assert manifest["coverage"]["coverageRatio"] == 1.0
    assert len(manifest["rows"]) == 3
    assert len(manifest["excludedRows"]) == 1
    assert manifest["gapMarkers"][0]["durationSeconds"] > 120
    assert manifest["excludedRows"][0]["excludeReason"] == "背景杂音"
    assert manifest["reverseIndex"]["s1"] == ["会议纪要[1]", "决议[1]", "待办[1]"]


def test_formal_markdown_is_distilled_and_evidence_markdown_is_lossless():
    records = _records()
    manifest = build_evidence_manifest(records, _chronicle())
    formal = render_formal_markdown({"title": "预算例会", "type": "办公会"}, records)
    evidence = render_evidence_markdown({"title": "预算例会"}, records, manifest)
    assert "这是一条应保留的完整原始证据长句" not in formal
    assert "本正式件仅包含经校对的蒸馏内容" in formal
    assert "这是一条应保留的完整原始证据长句" in evidence
    assert "噪音行" in evidence
    assert "录音断档" in evidence
    assert "chunk-0001" in evidence
    assert "没有原文支持的虚构决议" in evidence
    assert "没有原文支持的虚构决议" not in formal


def test_formal_document_requires_proofread(tmp_path: Path):
    with pytest.raises(ProofreadRequiredError):
        generate_document_bundle(
            "m1", {"title": "例会"}, _records(proofread=False), _chronicle(), tmp_path,
            timestamp="20260821160000",
        )


def test_document_bundle_writes_two_independent_docx_files(tmp_path: Path):
    bundle = generate_document_bundle(
        "m1", {
            "title": "预算例会",
            "type": "办公会",
            "date": "2026-08-21 14:00-16:30",
            "location": "七楼会议室",
            "host": "张三",
            "recorder": "李四",
            "participants": [{"name": "王五"}, {"name": "赵六"}],
            "compiler": "李四",
        },
        _records(), _chronicle(), tmp_path, timestamp="20260821160000",
    )
    formal_path = Path(bundle["formal"]["path"])
    evidence_path = Path(bundle["evidence"]["path"])
    assert formal_path.exists() and evidence_path.exists()
    assert formal_path != evidence_path
    assert bundle["coverage"]["coverageRatio"] == 1.0
    from docx import Document

    formal_doc = Document(formal_path)
    formal_text = "\n".join(
        [paragraph.text for paragraph in formal_doc.paragraphs]
        + [cell.text for table in formal_doc.tables for row in table.rows for cell in row.cells]
    )
    evidence_text = "\n".join(paragraph.text for paragraph in Document(evidence_path).paragraphs)
    assert formal_path.name == "m1_会议记录_20260821160000.docx"
    assert "会 议 记 录" in formal_text
    assert "会议名称" in formal_text and "预算例会" in formal_text
    assert "会议地点" in formal_text and "七楼会议室" in formal_text
    assert "主持人" in formal_text and "张三" in formal_text
    assert "记录人" in formal_text and "李四" in formal_text
    assert "参加单位及人员：王五、赵六" in formal_text
    assert "编制人" in formal_text
    assert "生成参数快照" not in formal_text
    assert "这是一条应保留的完整原始证据长句" not in formal_text
    assert "这是一条应保留的完整原始证据长句" in evidence_text
    assert "背景杂音" in evidence_text
    assert "没有原文支持的虚构决议" in evidence_text


def test_document_template_changes_real_word_heading(tmp_path: Path):
    bundle = generate_document_bundle(
        "m2", {"title": "重大事项会"}, _records(), _chronicle(), tmp_path,
        timestamp="20260831120000", template_id="major",
    )
    from docx import Document

    text = "\n".join(paragraph.text for paragraph in Document(bundle["formal"]["path"]).paragraphs)
    assert "三重一大会议纪要" in text
    assert bundle["templateId"] == "major"
