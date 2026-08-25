"""会议材料服务：上传、列表与下载元数据。"""

import re
import uuid
from datetime import datetime
from pathlib import Path

from backend.config import MEETING_FILES_DIR, MEETINGS_LOCK
from backend.db import _check_meeting_access, _invalidate_meetings_cache, _load_meetings, _save_meetings, _safe_meeting_id
from backend.services.recording_service import atomic_write


def safe_filename(value: str) -> str:
    name = Path(str(value or "meeting-material")).name
    name = re.sub(r"[^a-zA-Z0-9_.\-\u4e00-\u9fff ]", "_", name).strip(" .")
    return name[:160] or "meeting-material"


def _meeting_or_error(meeting_id: str, user: dict):
    safe_id = _safe_meeting_id(meeting_id)
    meeting = _load_meetings().get(safe_id)
    if not meeting:
        raise KeyError("会议不存在")
    _check_meeting_access(user, meeting)
    return safe_id, meeting


def list_materials(meeting_id: str, user: dict) -> list[dict]:
    _, meeting = _meeting_or_error(meeting_id, user)
    return list(meeting.get("materials") or [])


def save_material(meeting_id: str, material_name: str, original_name: str, content: bytes, user: dict) -> tuple[dict, dict]:
    with MEETINGS_LOCK:
        safe_id, meeting = _meeting_or_error(meeting_id, user)
        if not content:
            raise ValueError("上传文件不能为空")
        safe_original = safe_filename(original_name)
        material_id = f"mat_{uuid.uuid4().hex[:12]}"
        stored_name = f"{material_id}_{safe_original}"
        storage_dir = MEETING_FILES_DIR / safe_id
        storage_dir.mkdir(parents=True, exist_ok=True)
        atomic_write(storage_dir / stored_name, content)
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        record = {
            "id": material_id,
            "name": str(material_name or safe_original).strip()[:160] or safe_original,
            "status": "已上传",
            "tone": "green",
            "fileName": safe_original,
            "storedName": stored_name,
            "size": len(content),
            "uploadedAt": now,
            "uploader": user.get("name") or user.get("username") or "参会人",
            "downloadUrl": f"/api/meetings/{safe_id}/materials/{material_id}/download",
        }
        materials = [item for item in (meeting.get("materials") or []) if item.get("name") != record["name"]]
        materials.append(record)
        meeting["materials"] = materials
        meeting.setdefault("events", []).append({
            "id": f"material_{uuid.uuid4().hex[:10]}",
            "type": "material",
            "serverTime": now,
            "materialId": material_id,
            "materialName": record["name"],
            "fileName": safe_original,
            "uploader": record["uploader"],
        })
        meeting["events"] = meeting["events"][-200:]
        meeting["updatedAt"] = now
        meetings = _load_meetings()
        meetings[safe_id] = meeting
        _save_meetings(meetings)
        _invalidate_meetings_cache()
    return record, meeting


def resolve_material(meeting_id: str, material_id: str, user: dict) -> tuple[dict, Path]:
    safe_id, meeting = _meeting_or_error(meeting_id, user)
    material = next((item for item in meeting.get("materials", []) if item.get("id") == material_id), None)
    if not material:
        raise KeyError("材料不存在")
    stored_name = safe_filename(material.get("storedName") or "")
    path = (MEETING_FILES_DIR / safe_id / stored_name).resolve()
    root = (MEETING_FILES_DIR / safe_id).resolve()
    if root not in path.parents or not path.exists():
        raise FileNotFoundError("材料文件不存在")
    return material, path
