"""Offline regression tests for Records Pipeline v2.

These tests use only deterministic local callbacks.  They exercise the
properties that must remain true when the real Qwen adapter is wired in:
audio-file boundaries, complete segment assignment, one retry per MAP,
bounded concurrency, verbatim evidence, and explicit v1 degradation.
"""

from __future__ import annotations

import asyncio
import json
import unittest

from backend.services.meeting_record_generation_service import (
    MeetingRecordGenerationService,
    _drop_semantically_unsupported,
    chunk_transcript_segments,
)


class MeetingRecordGenerationServiceTests(unittest.IsolatedAsyncioTestCase):
    def test_unrelated_real_quote_cannot_anchor_hallucinated_topic(self):
        records = {
            "minutes": [
                {
                    "agenda": "睡眠产品 A-Sleep 介绍",
                    "keyPoints": ["推广睡眠产品"],
                    "basis": {
                        "evidenceValid": True,
                        "quotes": [{"text": "M5 Ultra 帧率在146帧左右"}],
                    },
                },
                {
                    "agenda": "Mac Studio 性能评测",
                    "keyPoints": ["M5 Ultra 帧率约146帧"],
                    "basis": {
                        "evidenceValid": True,
                        "quotes": [{"text": "M5 Ultra 帧率在146帧左右"}],
                    },
                },
            ],
            "decisions": [], "risks": [], "disclosures": [], "todos": [],
        }

        dropped = _drop_semantically_unsupported(records)

        self.assertEqual(dropped, 1)
        self.assertEqual(len(records["minutes"]), 2)
        self.assertFalse(records["minutes"][0]["basis"]["evidenceValid"])
        self.assertEqual(records["minutes"][0]["basis"]["evidenceIssue"], "semantic_mismatch")
        self.assertEqual(records["minutes"][0]["status"], "待人工核验")
        self.assertTrue(records["minutes"][1]["basis"]["evidenceValid"])

    def test_chunking_keeps_audio_file_boundaries_and_4000_char_limit(self):
        source = [
            {"id": "a-1", "fileId": "audio-a", "start": 0, "end": 2, "text": "甲" * 1500},
            {"id": "a-2", "fileId": "audio-a", "start": 2, "end": 4, "text": "乙" * 1500},
            {"id": "b-1", "fileId": "audio-b", "start": 0, "end": 3, "text": "丙" * 8500},
        ]

        chunks = chunk_transcript_segments(source, max_chars=4000)

        self.assertGreaterEqual(len(chunks), 4)
        self.assertTrue(all(len(chunk.text) <= 4000 for chunk in chunks))
        self.assertTrue(all(len({segment.file_id for segment in chunk.segments}) == 1 for chunk in chunks))
        assigned = {segment.id for chunk in chunks for segment in chunk.segments}
        self.assertEqual(assigned, {"a-1", "a-2", "b-1"})
        self.assertEqual(sum(len(segment.text) for chunk in chunks for segment in chunk.segments), 11500)

    async def test_map_reduce_is_bounded_retries_and_keeps_verbatim_basis(self):
        source = [
            {"id": f"seg-{index}", "fileId": f"audio-{index}", "start": index * 10, "end": index * 10 + 4,
             "speaker": "张三", "text": f"原文事项{index}：同意保留第{index}项，需要披露合规风险并补充材料。"}
            for index in range(5)
        ]
        state = {"active": 0, "maxActive": 0, "mapCalls": 0, "reduceCalls": 0}

        async def map_call(prompt, context):
            state["active"] += 1
            state["maxActive"] = max(state["maxActive"], state["active"])
            state["mapCalls"] += 1
            try:
                await asyncio.sleep(0.005)
                chunk = context["chunk"]
                segment = chunk["segments"][0]
                if chunk["chunkId"] == "chunk-0002" and context["attempt"] == 1:
                    return "not-json"
                return {
                    "chunkSummary": "已提取",
                    "topics": [{"title": f"议题{chunk['chunkId']}", "timeRange": chunk["timeRange"]}],
                    "conclusions": [{
                        "content": f"同意保留第{chunk['order']}项",
                        "type": "决定",
                        "evidence": segment["text"],
                        "time": segment["time"].split("-")[0],
                    }],
                    "risks_disclosures": [{
                        "content": "披露合规风险",
                        "kind": "disclosure",
                        "severity": "中",
                        "evidence": segment["text"],
                        "time": segment["time"].split("-")[0],
                    }],
                    "todos": [{
                        "task": "补充材料",
                        "owner": "不存在的人",
                        "deadline": "未提及",
                        "evidence": segment["text"],
                        "time": segment["time"].split("-")[0],
                    }],
                    "corrections": [{"original": "引赛", "fixed": "引债", "reason": "词典"}],
                }
            finally:
                state["active"] -= 1

        async def reduce_call(prompt, context):
            state["reduceCalls"] += 1
            map_outputs = context["mapOutputs"]
            first = map_outputs[0]["conclusions"][0]
            return {
                "minutes": [{
                    "agenda": "保留第0项",
                    "status": "已记录",
                    "keyPoints": ["同意保留第0项"],
                    "basis": {"timeRange": "00:00:00-00:00:04", "quotes": [{"text": first["evidence"]}]},
                }],
                "decisions": [{
                    "content": "同意保留第0项",
                    "type": "决定",
                    "confidence": 0.9,
                    "basis": {"timeRange": "00:00:00-00:00:04", "quotes": [{"text": first["evidence"]}]},
                }],
                "risks": [],
                "disclosures": [{
                    "content": "披露合规风险",
                    "audience": "管理层",
                    "deadline": "待定",
                    "basis": {"timeRange": "00:00:00-00:00:04", "quotes": [{"text": first["evidence"]}]},
                }],
                "todos": [{
                    "task": "补充材料",
                    "owner": "张三",
                    "deadline": "待定",
                    "basis": {"timeRange": "00:00:00-00:00:04", "quotes": [{"text": first["evidence"]}]},
                }],
            }

        service = MeetingRecordGenerationService(
            map_call=map_call,
            reduce_call=reduce_call,
            concurrency=2,
            glossary=[{"term": "引债", "aliases": ["引赛"]}],
        )
        records = await service.generate("meeting-1", source, participants=["张三"])

        self.assertEqual(records["pipelineStatus"], "ok")
        self.assertEqual(state["reduceCalls"], 1)
        self.assertEqual(state["mapCalls"], 6)  # 5 chunks + one retry
        self.assertLessEqual(state["maxActive"], 2)
        self.assertEqual(records["generationSnapshot"]["mapCallCount"], 6)
        self.assertEqual(records["generationSnapshot"]["reduceCallCount"], 1)
        self.assertEqual(records["coverage"]["coverageRatio"], 1.0)
        self.assertEqual(records["coverage"]["sourceSegmentCount"], 5)
        self.assertEqual(records["decisions"][0]["basis"]["quotes"][0]["text"], source[0]["text"])
        self.assertTrue(records["decisions"][0]["basis"]["evidenceValid"])
        self.assertEqual(records["todos"][0]["owner"], "张三")
        self.assertEqual(len(records["disclosures"]), 1)
        self.assertEqual(records["proofreadLog"][0]["fixed"], "引债")

    async def test_second_map_failure_uses_explicit_degraded_v1_fallback(self):
        source = [{"id": "seg-1", "fileId": "audio-a", "start": 0, "end": 2, "text": "旧管线结果原始依据"}]
        state = {"mapCalls": 0, "fallbackCalls": 0}

        async def broken_map(prompt, context):
            state["mapCalls"] += 1
            return "{invalid"

        def fallback(segments, context):
            state["fallbackCalls"] += 1
            return {
                "decisions": [{
                    "content": "旧管线结果",
                    "type": "知悉",
                    "basis": {"timeRange": "00:00:00-00:00:02", "quotes": [{"text": "旧管线结果原始依据"}]},
                }]
            }

        service = MeetingRecordGenerationService(map_call=broken_map, v1_fallback=fallback)
        records = await service.generate("meeting-fallback", source)

        self.assertEqual(state["mapCalls"], 2)
        self.assertEqual(state["fallbackCalls"], 1)
        self.assertEqual(records["pipelineStatus"], "degraded")
        self.assertTrue(records["degraded"])
        self.assertIn("one retry", records["degradedReason"])
        self.assertEqual(records["decisions"][0]["content"], "旧管线结果")
        self.assertTrue(records["decisions"][0]["basis"]["evidenceValid"])

    async def test_rewritten_reduce_evidence_uses_only_verified_map_quote(self):
        source = [{"id": "seg-1", "fileId": "audio-a", "start": 0, "end": 2, "text": "原文保留预算"}]

        async def map_call(prompt, context):
            segment = context["chunk"]["segments"][0]
            return {"conclusions": [{"content": "保留预算", "evidence": segment["text"]}]}

        async def reduce_call(prompt, context):
            return {"decisions": [{
                "content": "保留预算",
                "basis": {"timeRange": "00:00:00-00:00:02", "quotes": [{"text": "润色后的预算依据"}]},
            }]}

        service = MeetingRecordGenerationService(map_call=map_call, reduce_call=reduce_call)
        records = await service.generate("meeting-evidence", source)

        basis = records["decisions"][0]["basis"]
        self.assertTrue(basis["evidenceValid"])
        self.assertEqual(basis["quotes"][0]["text"], source[0]["text"])
        self.assertNotIn("润色后的预算依据", [quote["text"] for quote in basis["quotes"]])
        self.assertEqual(records["coverage"]["evidenceSegmentCount"], 1)
        self.assertTrue(records["proofreadPassed"])
        self.assertEqual(records["proofreadStatus"], "auto-evidence-verified")
        self.assertTrue(records["minutes"])

    async def test_qwen_reduce_missing_basis_and_minutes_is_recovered_from_map(self):
        source = [
            {"id": "seg-1", "fileId": "audio-a", "start": 0, "end": 2, "text": "原文同意调整预算"},
            {"id": "seg-2", "fileId": "audio-a", "start": 2, "end": 4, "text": "原文披露资金风险并补充材料"},
        ]

        async def map_call(_prompt, context):
            return {
                "topics": [{"title": "预算调整与风险"}],
                "conclusions": [{
                    "content": "同意调整预算",
                    "type": "决定",
                    "evidence": "原文同意调整预算",
                    "time": "00:00:00",
                }],
                "risks_disclosures": [{
                    "content": "披露资金风险",
                    "kind": "disclosure",
                    "severity": "中",
                    "evidence": "原文披露资金风险并补充材料",
                    "time": "00:00:02",
                }],
                "todos": [{
                    "task": "补充材料",
                    "owner": "张三",
                    "deadline": "待定",
                    "evidence": "原文披露资金风险并补充材料",
                    "time": "00:00:02",
                }],
            }

        async def reduce_call(_prompt, _context):
            # Typical Qwen response: valid JSON, but it omits all basis fields
            # and forgets to emit minutes.
            return {
                "minutes": [],
                "decisions": [{"content": "同意调整预算", "type": "决定"}],
                "risks": [],
                "disclosures": [{"content": "披露资金风险", "audience": "管理层"}],
                "todos": [{"task": "补充材料", "owner": "张三", "deadline": "待定"}],
            }

        records = await MeetingRecordGenerationService(
            map_call=map_call,
            reduce_call=reduce_call,
        ).generate("meeting-qwen-missing-basis", source, participants=["张三"])

        self.assertEqual(records["basisRecovery"]["recovered"], 3)
        self.assertEqual(records["basisRecovery"]["minutesGenerated"], 1)
        self.assertEqual(records["basisRecovery"]["unmatched"], 0)
        self.assertEqual(records["minutes"][0]["agenda"], "预算调整与风险")
        self.assertTrue(records["minutes"][0]["basis"]["evidenceValid"])
        self.assertTrue(records["decisions"][0]["basis"]["evidenceValid"])
        self.assertTrue(records["disclosures"][0]["basis"]["evidenceValid"])
        self.assertTrue(records["todos"][0]["basis"]["evidenceValid"])
        self.assertEqual(records["todos"][0]["owner"], "张三")
        self.assertTrue(records["proofreadPassed"])
        self.assertEqual(records["proofreadStatus"], "auto-evidence-verified")

    async def test_cross_segment_evidence_with_copy_noise_recovers_verbatim_rows(self):
        source = [
            {"id": "seg-1", "fileId": "audio-a", "start": 10, "end": 12,
             "speaker": "张三", "text": "预算调整方案由财务部"},
            {"id": "seg-2", "fileId": "audio-a", "start": 12, "end": 15,
             "speaker": "张三", "text": "在本周五前提交。"},
        ]

        async def map_call(_prompt, _context):
            return {
                "topics": [{"title": "预算调整"}],
                "todos": [{
                    "task": "财务部在本周五前提交预算调整方案",
                    "owner": "张三",
                    "evidence": "预算调整方案由财务部，在本周伍前提交",
                }],
            }

        async def reduce_call(_prompt, _context):
            return {
                "minutes": [{"agenda": "预算调整", "keyPoints": []}],
                "todos": [{"task": "财务部在本周五前提交预算调整方案", "owner": "张三"}],
            }

        records = await MeetingRecordGenerationService(
            map_call=map_call,
            reduce_call=reduce_call,
        ).generate("meeting-cross-segment", source, participants=["张三"])

        basis = records["todos"][0]["basis"]
        self.assertTrue(basis["evidenceValid"])
        self.assertEqual(basis["sourceSegmentIds"], ["seg-1", "seg-2"])
        self.assertEqual([quote["text"] for quote in basis["quotes"]], [
            "预算调整方案由财务部", "在本周五前提交。",
        ])
        self.assertEqual(basis["timeRange"], "00:00:10-00:00:15")
        self.assertEqual(records["basisRecovery"]["invalidMapEvidence"], 0)
        self.assertEqual(records["basisRecovery"]["unmatched"], 0)

    async def test_ambiguous_fuzzy_evidence_is_not_auto_bound(self):
        source = [
            {"id": "seg-1", "fileId": "audio-a", "start": 0, "end": 2, "text": "本周五前提交预算材料"},
            {"id": "seg-2", "fileId": "audio-a", "start": 4, "end": 6, "text": "本周五前提交审计材料"},
        ]

        async def map_call(_prompt, _context):
            return {"todos": [{"task": "本周五前提交材料", "evidence": "本周五前提交项目材料"}]}

        records = await MeetingRecordGenerationService(map_call=map_call).generate(
            "meeting-ambiguous-evidence", source,
        )

        self.assertEqual(records["basisRecovery"]["invalidMapEvidence"], 1)
        self.assertTrue(records["basisRecovery"]["unmatched"] >= 1)
        self.assertEqual(records["todos"], [])
        self.assertEqual(records["qualityIssues"], [])
        self.assertTrue(records["proofreadPassed"])
        self.assertTrue(any(item["field"] == "todos" for item in records["evidenceExceptions"]))

    async def test_reduce_combined_decision_merges_two_verified_map_bases(self):
        source = [
            {"id": "seg-1", "fileId": "audio-a", "start": 0, "end": 3,
             "text": "公共收益收入必须进入业主委员会账户。"},
            {"id": "seg-2", "fileId": "audio-a", "start": 3, "end": 7,
             "text": "房屋租金先进入业主委员会账户，再转给物业公司。"},
        ]

        async def map_call(_prompt, _context):
            return {
                "topics": [{
                    "title": "公共收益账户管理",
                    "evidence": "公共收益收入必须进入业主委员会账户。",
                }],
                "conclusions": [
                    {"content": "公共收益收入进入业主委员会账户", "evidence": source[0]["text"]},
                    {"content": "房屋租金进入业主委员会账户后转给物业", "evidence": source[1]["text"]},
                ],
            }

        async def reduce_call(_prompt, _context):
            return {
                "minutes": [{"agenda": "公共收益账户管理", "keyPoints": []}],
                "decisions": [{
                    "content": "公共收益和房屋租金必须进入业主委员会账户，再转给物业公司",
                    "type": "决定",
                }],
            }

        records = await MeetingRecordGenerationService(
            map_call=map_call, reduce_call=reduce_call,
        ).generate("meeting-composite-basis", source)

        basis = records["decisions"][0]["basis"]
        self.assertTrue(basis["evidenceValid"])
        self.assertEqual(basis["sourceSegmentIds"], ["seg-1", "seg-2"])
        self.assertEqual(records["basisRecovery"]["unmatched"], 0)

    async def test_unmatched_reduce_item_is_replaced_by_verified_map_content(self):
        source = [{
            "id": "seg-1",
            "fileId": "audio-a",
            "start": 0,
            "end": 2,
            "text": "原文同意调整预算",
        }]

        async def map_call(_prompt, _context):
            return {
                "topics": [{"title": "预算调整"}],
                "conclusions": [{
                    "content": "同意调整预算",
                    "evidence": "原文同意调整预算",
                    "time": "00:00:00",
                }],
            }

        async def reduce_call(_prompt, _context):
            return {
                "minutes": [],
                "decisions": [{"content": "完全无关的虚构事项", "type": "决定"}],
            }

        records = await MeetingRecordGenerationService(
            map_call=map_call,
            reduce_call=reduce_call,
        ).generate("meeting-qwen-unmatched", source)

        self.assertEqual(records["basisRecovery"]["minutesGenerated"], 1)
        self.assertEqual(records["basisRecovery"]["unmatched"], 1)
        self.assertEqual(records["decisions"][0]["content"], "同意调整预算")
        self.assertTrue(records["decisions"][0]["basis"]["evidenceValid"])
        self.assertTrue(any(
            item["field"] == "decisions" and item["item"]["content"] == "完全无关的虚构事项"
            for item in records["evidenceExceptions"]
        ))
        self.assertEqual(records["qualityIssues"], [])
        self.assertTrue(records["proofreadPassed"])

    async def test_reduce_failure_retries_once_and_records_actual_calls(self):
        source = [{"id": "seg-1", "fileId": "audio-a", "start": 0, "end": 2, "text": "同意推进项目"}]
        calls = {"reduce": 0}

        async def map_call(_prompt, context):
            segment = context["chunk"]["segments"][0]
            return {"conclusions": [{"content": "同意推进项目", "evidence": segment["text"]}]}

        async def reduce_call(_prompt, context):
            calls["reduce"] += 1
            if context["attempt"] == 1:
                raise TimeoutError("reduce timeout")
            return {"decisions": [{
                "content": "同意推进项目",
                "basis": {"timeRange": "00:00:00-00:00:02", "quotes": [{"text": "同意推进项目"}]},
            }]}

        records = await MeetingRecordGenerationService(
            map_call=map_call,
            reduce_call=reduce_call,
        ).generate("meeting-reduce-retry", source)

        self.assertEqual(calls["reduce"], 2)
        self.assertEqual(records["pipelineStatus"], "ok")
        self.assertFalse(records["degraded"])
        self.assertEqual(records["generationSnapshot"]["reduceCallCount"], 2)


if __name__ == "__main__":
    unittest.main()
