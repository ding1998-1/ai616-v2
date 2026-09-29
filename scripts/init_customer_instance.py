#!/usr/bin/env python3
"""Initialize one clean, isolated AI616 customer instance."""

from __future__ import annotations

import argparse
import getpass
import json
import os
import re
import secrets
import stat
import sys
from datetime import datetime
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA_ROOT = (PROJECT_ROOT / "data").resolve()


def _safe_customer_id(value: str) -> str:
    safe = re.sub(r"[^a-zA-Z0-9_-]", "-", value.strip()).strip("-")
    if not safe:
        raise ValueError("customer-id 只能包含字母、数字、下划线或连字符")
    return safe[:64]


def _env_value(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _ensure_clean_root(data_root: Path) -> None:
    if data_root == DEFAULT_DATA_ROOT:
        raise RuntimeError("客户数据目录不能使用项目现有 data 目录")
    if data_root.exists() and any(data_root.iterdir()):
        raise RuntimeError(f"客户数据目录不是空目录：{data_root}")
    data_root.mkdir(parents=True, exist_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="创建空白客户独立实例")
    parser.add_argument("--customer-id", required=True)
    parser.add_argument("--customer-name", required=True)
    parser.add_argument("--data-dir", required=True)
    parser.add_argument("--admin-username", default="admin")
    parser.add_argument("--admin-name", default="系统管理员")
    parser.add_argument("--admin-dept", default="信息管理中心")
    args = parser.parse_args()

    customer_id = _safe_customer_id(args.customer_id)
    data_root = Path(args.data_dir).expanduser().resolve()
    _ensure_clean_root(data_root)

    password = os.environ.get("AI616_BOOTSTRAP_ADMIN_PASSWORD", "")
    if not password:
        password = getpass.getpass("请输入首位管理员密码：")
    if len(password) < 8:
        raise RuntimeError("管理员密码至少 8 位")

    os.environ["AI616_INSTANCE_MODE"] = "customer"
    os.environ["AI616_SEED_DEMO_DATA"] = "0"
    os.environ["AI616_DATA_DIR"] = str(data_root)
    os.environ["APP_AUTH_SECRET"] = secrets.token_urlsafe(48)
    if str(PROJECT_ROOT) not in sys.path:
        sys.path.insert(0, str(PROJECT_ROOT))

    from backend.db import _init_app_db
    from backend.deps import _hash_password

    auth_dir = data_root / "auth"
    auth_dir.mkdir(parents=True, exist_ok=True)
    user = {
        "id": f"u_{args.admin_username}",
        "username": args.admin_username,
        "password": _hash_password(password),
        "name": args.admin_name,
        "role": "admin",
        "dept": args.admin_dept,
        "status": "active",
        "createdAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }
    (auth_dir / "users.json").write_text(
        json.dumps([user], ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (data_root / "instance.json").write_text(
        json.dumps(
            {
                "customerId": customer_id,
                "customerName": args.customer_name,
                "instanceMode": "customer",
                "createdAt": datetime.now().isoformat(timespec="seconds"),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    _init_app_db()

    env_path = data_root / "instance.env"
    env_path.write_text(
        "\n".join(
            [
                "AI616_INSTANCE_MODE=customer",
                "AI616_SEED_DEMO_DATA=0",
                f"AI616_DATA_DIR={_env_value(str(data_root))}",
                f"APP_AUTH_SECRET={_env_value(os.environ['APP_AUTH_SECRET'])}",
                f"AI616_CUSTOMER_ID={_env_value(customer_id)}",
                f"AI616_CUSTOMER_NAME={_env_value(args.customer_name)}",
                "",
            ]
        ),
        encoding="utf-8",
    )
    env_path.chmod(stat.S_IRUSR | stat.S_IWUSR)
    print(json.dumps({
        "success": True,
        "customerId": customer_id,
        "dataDir": str(data_root),
        "environmentFile": str(env_path),
        "adminUsername": args.admin_username,
        "meetings": 0,
        "transcripts": 0,
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
