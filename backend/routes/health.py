"""模块化核心应用健康检查。"""

import time

from fastapi import APIRouter

from backend.db import _db_connect, _init_app_db


_started_at = time.monotonic()
router = APIRouter(tags=["system"])


@router.get("/health")
async def health():
    checks = {}
    status = "ok"
    try:
        _init_app_db()
        with _db_connect() as conn:
            conn.execute("SELECT 1").fetchone()
            checks["db"] = "ok"
            checks["meetings"] = conn.execute("SELECT COUNT(*) FROM meetings").fetchone()[0]
            checks["transcripts"] = conn.execute("SELECT COUNT(*) FROM meeting_transcripts").fetchone()[0]
    except Exception as exc:
        checks["db"] = f"fail: {exc}"
        status = "degraded"
    return {"status": status, "checks": checks, "uptime_seconds": round(time.monotonic() - _started_at, 1)}
