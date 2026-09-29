#!/usr/bin/env python3
"""Verify that a customer instance contains no legacy customer data."""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import stat
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA_ROOT = (PROJECT_ROOT / "data").resolve()
DEMO_MEETING_IDS = {
    "meeting-gxq-fc-2026-02",
    "meeting-rsrm-2026-04",
    "meeting-cg-2026-11",
}


def _json_list(path: Path) -> list:
    if not path.exists():
        return []
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    return value if isinstance(value, list) else []


def _table_count(db_path: Path, table: str) -> int:
    if not db_path.exists():
        return 0
    with sqlite3.connect(db_path) as conn:
        row = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)
        ).fetchone()
        if not row:
            return 0
        return int(conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0])


def _payload_files(root: Path) -> list[str]:
    payload_dirs = ("meeting_files", "docs", "knowledge_files", "uploads", "contracts")
    found = []
    for name in payload_dirs:
        directory = root / name
        if directory.exists():
            found.extend(str(path.relative_to(root)) for path in directory.rglob("*") if path.is_file())
    return sorted(found)


def main() -> int:
    parser = argparse.ArgumentParser(description="验收客户独立实例的数据隔离")
    parser.add_argument("--data-dir", required=True)
    args = parser.parse_args()
    root = Path(args.data_dir).expanduser().resolve()
    users = _json_list(root / "auth" / "users.json")
    meetings = _table_count(root / "app.db", "meetings")
    transcripts = _table_count(root / "app.db", "meeting_transcripts")
    env_path = root / "instance.env"
    instance_path = root / "instance.json"
    demo_ids = []
    if (root / "app.db").exists() and meetings:
        with sqlite3.connect(root / "app.db") as conn:
            placeholders = ",".join("?" for _ in DEMO_MEETING_IDS)
            demo_ids = [row[0] for row in conn.execute(
                f"SELECT id FROM meetings WHERE id IN ({placeholders})", tuple(DEMO_MEETING_IDS)
            )]
    env_mode = stat.S_IMODE(env_path.stat().st_mode) if env_path.exists() else None
    checks = {
        "usesDedicatedDataDir": root != DEFAULT_DATA_ROOT,
        "instanceMetadataPresent": instance_path.is_file(),
        "environmentFilePresent": env_path.is_file(),
        "environmentFilePrivate": env_mode == 0o600,
        "singleBootstrapAdmin": len(users) == 1 and users[0].get("role") == "admin",
        "noDefaultPassword": bool(users) and str(users[0].get("password") or "").startswith("$pbkdf2-"),
        "zeroMeetings": meetings == 0,
        "zeroTranscripts": transcripts == 0,
        "noDemoMeetings": not demo_ids,
        "noCustomerPayloadFiles": not _payload_files(root),
    }
    report = {
        "success": all(checks.values()),
        "dataDir": str(root),
        "checks": checks,
        "counts": {
            "users": len(users),
            "meetings": meetings,
            "transcripts": transcripts,
            "payloadFiles": len(_payload_files(root)),
        },
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["success"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
