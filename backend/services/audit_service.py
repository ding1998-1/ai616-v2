"""合规审核服务。

审核流程拆成规则提取、材料校验、程序完整性、责任主体和报告生成五个步骤。
HTTP/SSE 细节由 ``routes/audit.py`` 负责，服务不依赖 FastAPI 路由函数，便于测试。
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from collections.abc import AsyncIterator

from audit_persistence import persistence
from backend.config import llm_semaphore
from backend.llm_client import current_request, llm
from backend.services.rules_service import (
    check_procedure_completeness,
    extract_rules,
    identify_responsibility,
    resolve_custom_rules_text,
    validate_material,
)


logger = logging.getLogger(__name__)


def sanitize_report(text: str) -> str:
    """清理模型可能泄露的工具调用/代码围栏。"""
    text = re.sub(r"```[\s\S]*?```", "", text or "")
    text = re.sub(r"^(Action|Observation|Thought|Action Input)\s*:.*$", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\s*[\{\[][^\n]*[\}\]]\s*$", "", text, flags=re.MULTILINE)
    text = re.sub(r"^Final Answer\s*:\s*", "", text, flags=re.MULTILINE)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def build_deterministic_report(matter_type: str, material: str, results: dict) -> str:
    """LLM 不可用时的可审计降级报告，保证前端仍可完成审核流程。"""
    validation = results.get("validation") or []
    procedure = results.get("procedure") or []
    responsibility = results.get("responsibility") or ""
    risk = "高风险" if any("不合规" in str(item) for item in validation) else (
        "中风险" if any(item.get("状态") == "缺失" for item in procedure if isinstance(item, dict)) else "低风险"
    )
    lines = [
        "<risk_radar>",
        f'<item status="{"red" if risk == "高风险" else "yellow" if risk == "中风险" else "green"}">综合风险({risk})</item>',
        "</risk_radar>",
        "## 一、审核基本信息",
        "| 项目 | 内容 |",
        "|---|---|",
        f"| 审核类型 | {matter_type or '未指定'} |",
        "| 审核方式 | 规则校验降级结果 |",
        f"| 材料字数 | {len(material or '')} |",
        "",
        "## 二、风险等级评定",
        f"当前规则校验风险等级：**{risk}**。该结果来自制度关键词命中率及程序覆盖情况，需人工复核。",
        "",
        "## 三、违规事项与证据清单",
    ]
    if validation:
        lines.extend(f"- {item.get('状态', '')}：{item.get('规则', '')}；证据：{item.get('证据', '无')}" for item in validation if isinstance(item, dict))
    else:
        lines.append("- 未生成规则校验条目，请补充适用制度。")
    lines.extend(["", "## 四、程序完整性核查", "| 程序环节 | 状态 |", "|---|---|"])
    lines.extend(f"| {item.get('环节', '')} | {item.get('状态', '')} |" for item in procedure if isinstance(item, dict))
    lines.extend([
        "",
        "## 五、责任主体认定",
        responsibility or "未识别责任主体。",
        "",
        "## 六、整改建议",
        "**建议1**：由承办部门补齐缺失材料和程序证据，并由合规部门复核。",
        "",
        "## 七、决策溯源档案（电子档案）",
        "审核结果已保留材料、规则和校验结果，可供人工复核和后续归档。",
        "",
        "## 八、整改闭环管理",
        "建议按整改通知、报告上报和复核销号完成闭环。",
        "",
        "## 九、统计分析与驾驶舱",
        "当前审核结果可纳入系统统计看板。",
        "",
        "> 📋 本报告由 AI 合规审核系统自动生成，仅供参考，最终结论以人工复核为准。",
    ])
    return "\n".join(lines)


def _event(event_type: str, **payload) -> str:
    return f"data: {json.dumps({'type': event_type, **payload}, ensure_ascii=False)}\n\n"


async def stream_audit(
    request,
    matter_type: str,
    material: str,
    custom_rule_ids: list[str] | None = None,
) -> AsyncIterator[str]:
    """生成合规审核 SSE 事件。"""
    current_request.set(request)
    rules = extract_rules(matter_type, resolve_custom_rules_text(custom_rule_ids, matter_type))
    yield _event("tool_start", tool="extract_rules")
    yield _event("tool_end", tool="extract_rules", result=json.dumps(rules, ensure_ascii=False))

    yield _event("tool_start", tool="validate_material")
    yield _event("tool_start", tool="check_procedure_completeness")
    yield _event("tool_start", tool="identify_responsibility")
    validation = validate_material(material, rules)
    procedure = check_procedure_completeness(material, rules)
    responsibility = identify_responsibility(material, rules)
    yield _event("tool_end", tool="validate_material", result=json.dumps(validation, ensure_ascii=False))
    yield _event("tool_end", tool="check_procedure_completeness", result=json.dumps(procedure, ensure_ascii=False))
    yield _event("tool_end", tool="identify_responsibility", result=responsibility)

    results = {"rules": rules, "validation": validation, "procedure": procedure, "responsibility": responsibility}
    fallback = build_deterministic_report(matter_type, material, results)
    full_response = ""
    yield _event("tool_start", tool="generate_compliance_report")
    try:
        if not getattr(llm, "api_key", ""):
            raise RuntimeError("LLM API key is not configured")
        prompt = _build_audit_prompt(matter_type, material, results)
        from langchain_core.messages import HumanMessage, SystemMessage

        async with llm_semaphore:
            async for chunk in llm._astream(
                [
                    SystemMessage(content="你是资深国企合规审核专家。直接输出审核报告正文，不输出思考过程。"),
                    HumanMessage(content=prompt),
                ],
                enable_thinking=False,
            ):
                if await request.is_disconnected():
                    raise asyncio.CancelledError()
                text = chunk.message.content
                chunk_type = chunk.message.additional_kwargs.get("chunk_type", "content")
                if not text:
                    continue
                if chunk_type == "thinking":
                    yield _event("thinking_chunk", content=text)
                else:
                    full_response += text
                    yield _event("llm_chunk", content=text)
        report = sanitize_report(full_response) or fallback
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        logger.warning("审核 LLM 失败，使用规则降级报告：%s", exc)
        report = fallback
        yield _event("degraded", reason="LLM 不可用，已使用规则校验结果生成报告")

    yield _event("tool_end", tool="generate_compliance_report")
    try:
        persistence.save_audit(matter_type=matter_type, material=material, report=report, results=results)
    except Exception:
        logger.exception("审核记录归档失败")
    yield _event("report", content=report)
    yield 'data: {"type": "done"}\n\n'


def _build_audit_prompt(matter_type: str, material: str, results: dict) -> str:
    return f"""请基于以下材料和规则校验结果，生成专业、严谨的中文 Markdown 合规审核报告。

审核类型：{matter_type}
材料：
{material}

规则提取：{json.dumps(results['rules'], ensure_ascii=False)}
材料校验：{json.dumps(results['validation'], ensure_ascii=False)}
程序完整性：{json.dumps(results['procedure'], ensure_ascii=False)}
责任主体：{results['responsibility']}

报告必须包含风险雷达 XML，以及审核基本信息、风险等级、违规事项与证据、程序核查、责任主体、整改建议、决策溯源、整改闭环和统计分析九个章节。不得输出 JSON、工具调用或思考过程。"""


def audit_history() -> list[dict]:
    try:
        from demo_content import build_archive_history

        return build_archive_history(persistence.get_history())
    except Exception:
        logger.exception("审核历史加载失败")
        return []


TEMPLATE_SYSTEM_PROMPT = "你是专门负责输出国企标准化公文的 AI 助手。只输出公文正文，不解释思考过程。"


async def stream_template(request, message: str) -> AsyncIterator[str]:
    """公文模板 SSE；无 LLM 时返回明确降级文本。"""
    current_request.set(request)
    fallback = f"# 公文草案\n\n## 起草要求\n{message}\n\n> 待人工补充并复核。"
    try:
        if not getattr(llm, "api_key", ""):
            raise RuntimeError("LLM API key is not configured")
        from langchain_core.messages import HumanMessage, SystemMessage

        async with llm_semaphore:
            async for chunk in llm._astream(
                [SystemMessage(content=TEMPLATE_SYSTEM_PROMPT), HumanMessage(content=message)],
                enable_thinking=False,
            ):
                if await request.is_disconnected():
                    raise asyncio.CancelledError()
                text = chunk.message.content
                if text:
                    yield _event("llm_chunk", content=text)
        yield 'data: {"type": "done"}\n\n'
    except asyncio.CancelledError:
        raise
    except Exception:
        yield _event("degraded", reason="LLM 不可用，已返回起草占位内容")
        yield _event("llm_chunk", content=fallback)
        yield 'data: {"type": "done"}\n\n'
