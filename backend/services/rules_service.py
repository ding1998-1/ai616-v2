"""制度规则服务。

规则文件使用独立 JSON 存储，路由层只负责认证、上传参数和 HTTP 状态码。
"""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime
from pathlib import Path

from backend.config import CUSTOM_RULES_DB, RULES_IMAGES_DIR
from backend.services.document_service import parse_document_bytes


RULES_DB = {
    "重大决策": {
        "强制要求": "必须经党委前置研究讨论；集体决策；法律审查；会议纪要存档。",
        "禁止事项": "禁止个人或少数人决定；无会议纪要；未经法律审查。",
        "决策程序": ["提出书面建议书", "党支部审查列入", "承办部门拟方案", "征求意见", "院办公室报告", "院务会议集体讨论表决", "实施与监督"],
        "责任主体": "党委书记/董事长主持；主管领导论证；法律合规部审查；纪检监督部监督。",
    },
    "重大项目安排": {
        "强制要求": "必须可行性报告、风险评估、法律审查；党委前置；必须包含关联项目编码（Project ID）以穿透项目全生命周期库资金链；必须经公共资源交易中心招投标系统自动比对。",
        "禁止事项": "禁止超预算、无审批；严禁重复立项或超概算支付；严禁先斩后奏的违规招标。",
        "决策程序": ["项目审查", "专家论证", "征求意见", "会议决策", "公示", "正式审批"],
        "责任主体": "战略规划部论证；法律合规部审查。",
    },
    "大额度资金运作": {
        "强制要求": "必须资金使用计划；双人签字或集体审批；必须与财务系统联动，校验提取资金数据，核查隐性债务红线及融资成本上限。",
        "禁止事项": "禁止私下转账、无审计记录；严禁违规新增地方政府隐性债务。",
        "决策程序": ["安排预算", "党组集体研究", "公开公示", "资金拨付"],
        "责任主体": "财务部门执行；审计部监督。",
    },
    "重要人事任免": {
        "强制要求": "坚持党管干部；事先征求纪检意见；集体决定；任前公示；试用期考核。",
        "禁止事项": "禁止个人决定。",
        "决策程序": ["民主推荐", "组织考察", "会议决定", "任前公示", "试用1年", "正式任免"],
        "责任主体": "人力资源部考察；纪检监督部意见。",
    },
}


def load_custom_rules() -> list[dict]:
    if not CUSTOM_RULES_DB.exists():
        return []
    try:
        value = json.loads(CUSTOM_RULES_DB.read_text(encoding="utf-8"))
        return value if isinstance(value, list) else []
    except (OSError, json.JSONDecodeError):
        return []


def save_custom_rules(files: list[dict]) -> None:
    CUSTOM_RULES_DB.parent.mkdir(parents=True, exist_ok=True)
    CUSTOM_RULES_DB.write_text(json.dumps(files, ensure_ascii=False, indent=2), encoding="utf-8")


def summarize_custom_rule(raw_text: str, matter_type: str) -> dict:
    lines = [line.strip() for line in str(raw_text or "").splitlines() if line.strip()]
    focused = []
    for line in lines:
        if matter_type in line or any(word in line for word in ("必须", "禁止", "程序", "审议", "审批", "公示", "表决", "集体研究")):
            focused.append(line)
        if len(focused) >= 8:
            break
    focused = focused or lines[:8]
    mandatory = [line for line in focused if "必须" in line or "应当" in line][:4]
    forbidden = [line for line in focused if "禁止" in line or "不得" in line][:4]
    procedures = []
    for line in focused:
        parts = re.split(r"[、，；。]", line)
        procedures.extend(
            part.strip()
            for part in parts
            if len(part.strip()) >= 2 and any(word in part for word in ("审查", "论证", "公示", "表决", "审批", "研究"))
        )
        if len(procedures) >= 6:
            break
    return {
        "summary_lines": focused,
        "mandatory": mandatory,
        "forbidden": forbidden,
        "procedures": procedures[:6],
    }


def resolve_custom_rules_text(rule_ids: list[str] | None, matter_type: str) -> str:
    if not rule_ids:
        return ""
    selected = [
        item
        for item in load_custom_rules()
        if item.get("id") in rule_ids and item.get("matterType") in (matter_type, "通用", None)
    ]
    return "\n\n".join(f"【{item.get('name', '制度文件')}】\n{item.get('parsedText', '')[:4000]}" for item in selected)


def extract_rules(matter_type: str, custom_rules_text: str = "") -> dict:
    """提取审核所需的规则结构，供审核流和测试复用。"""
    data = dict(RULES_DB.get((matter_type or "").strip(), {"error": "未匹配事项类型"}))
    if "error" in data or not custom_rules_text.strip():
        return data
    summary = summarize_custom_rule(custom_rules_text, matter_type)
    if summary["mandatory"]:
        data["强制要求"] = f"{data.get('强制要求', '')}；自定义制度补充：{'；'.join(summary['mandatory'])}"
    if summary["forbidden"]:
        data["禁止事项"] = f"{data.get('禁止事项', '')}；自定义制度补充：{'；'.join(summary['forbidden'])}"
    if summary["procedures"]:
        data["决策程序"] = list(dict.fromkeys(data.get("决策程序", []) + summary["procedures"]))
    data["自定义制度摘要"] = summary["summary_lines"]
    return data


def validate_material(material_text: str, rules: dict) -> list[dict] | dict:
    if "error" in rules:
        return {"error": rules["error"]}
    sentences = [sentence.strip() for sentence in str(material_text or "").split("。") if sentence.strip()]
    report = []
    for key in ("强制要求", "禁止事项"):
        rule_text = rules.get(key)
        if not rule_text:
            continue
        keywords = [word for word in rule_text.replace("；", "、").replace("，", "、").split("、") if len(word) >= 2]
        best_evidence, best_hits = "无明显证据", 0
        for sentence in sentences:
            hits = sum(1 for keyword in keywords if keyword in sentence)
            if hits > best_hits:
                best_hits, best_evidence = hits, sentence
        hit_rate = best_hits / max(len(keywords), 1)
        report.append(
            {
                "规则": rule_text,
                "状态": "合规" if hit_rate > 0.3 else "⚠️ 不合规",
                "关键词命中率": round(hit_rate, 2),
                "证据": best_evidence,
            }
        )
    return report


def check_procedure_completeness(material_text: str, rules: dict) -> list[dict] | dict:
    if "error" in rules:
        return {"error": rules["error"]}
    return [{"环节": step, "状态": "已覆盖" if step in material_text else "缺失"} for step in rules.get("决策程序", [])]


def identify_responsibility(material_text: str, rules: dict) -> str:
    if "error" in rules:
        return f"责任主体规则不可用：{rules['error']}"
    subject = rules.get("责任主体", "")
    return "责任主体明确，监督机制提及。" if subject and subject in material_text else "责任主体或监督缺失，请补充。"


def create_custom_rule(filename: str, raw: bytes, matter_type: str) -> dict:
    if Path(filename or "").suffix.lower() != ".pdf":
        raise ValueError("制度文件仅支持 PDF 上传")
    parsed_text = parse_document_bytes(filename, raw)
    summary = summarize_custom_rule(parsed_text, matter_type)
    record = {
        "id": f"rule_{uuid.uuid4().hex[:12]}",
        "name": Path(filename).name,
        "matterType": matter_type or "通用",
        "uploadedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "charCount": len(parsed_text),
        "parsedText": parsed_text,
        "summaryLines": summary["summary_lines"],
    }
    files = load_custom_rules()
    files.insert(0, record)
    save_custom_rules(files)
    return record


def delete_custom_rule(rule_id: str) -> bool:
    files = load_custom_rules()
    filtered = [item for item in files if item.get("id") != rule_id]
    if len(filtered) == len(files):
        return False
    save_custom_rules(filtered)
    return True


def list_rules_gallery() -> list[dict]:
    # demo_content is intentionally imported here to keep application import light.
    from demo_content import get_demo_assets

    gallery = []
    for item in get_demo_assets().get("rulesGallery", []):
        item = dict(item)
        item["imageUrl"] = f"/api/rules_images/{item.get('filename', '')}"
        gallery.append(item)
    return gallery


def resolve_rules_image(filename: str) -> Path:
    safe_name = re.sub(r"[^a-zA-Z0-9_.-]", "", str(filename or ""))
    if safe_name != filename:
        raise ValueError("文件名包含非法字符")
    path = (RULES_IMAGES_DIR / safe_name).resolve()
    root = RULES_IMAGES_DIR.resolve()
    if root not in path.parents and path != root:
        raise PermissionError("禁止访问目录外文件")
    if not path.exists():
        raise FileNotFoundError("规则图片不存在")
    return path
