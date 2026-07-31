#!/usr/bin/env python3
"""
数据库备份脚本 — SQLite WAL checkpoint + 安全复制 + 过期清理

用法:
    python backup_db.py              # 手动备份
    python backup_db.py --restore    # 列出可用备份
    python backup_db.py --restore 20260616_140000  # 恢复到指定备份

调度:
    # crontab 每小时一次
    0 * * * * /home/ai/miniconda3/envs/ai_compliance/bin/python /home/ai/文档/ai616/backup_db.py

备份策略:
    - 每小时备份，保留 7×24=168 份
    - 每天 00:00 的备份额外保留为日备份，保留 30 天
"""

import os
import sys
import sqlite3
import shutil
import glob
import re
from pathlib import Path
from datetime import datetime, timedelta

PROJECT_ROOT = Path(__file__).resolve().parent
APP_DB = PROJECT_ROOT / "data" / "app.db"
BACKUP_DIR = PROJECT_ROOT / "data" / "backups"
BACKUP_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE = PROJECT_ROOT / "data" / "backup.log"

HOURLY_RETENTION = 7 * 24   # 保留 7 天的每小时备份
DAILY_RETENTION = 30        # 保留 30 天的日备份
DAILY_HOUR = 2              # 02:00 的备份标记为日备份


def log(msg: str):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{timestamp}] {msg}"
    print(line)
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def checkpoint_wal():
    """强制 WAL checkpoint，将未写入的 WAL 帧合并到主数据库文件。"""
    try:
        conn = sqlite3.connect(str(APP_DB))
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        conn.close()
        log("WAL checkpoint 完成")
    except Exception as e:
        log(f"WAL checkpoint 失败: {e}")
        # 继续——即使 checkpoint 失败，备份仍是有效快照


def create_backup() -> Path:
    """创建带时间戳的备份文件。"""
    now = datetime.now()
    ts = now.strftime("%Y%m%d_%H%M%S")
    backup_path = BACKUP_DIR / f"app_{ts}.db"
    shutil.copy2(APP_DB, backup_path)
    log(f"备份完成: {backup_path.name} ({backup_path.stat().st_size / 1024 / 1024:.1f} MB)")
    return backup_path


def cleanup_old_backups():
    """清理过期备份。"""
    backups = sorted(BACKUP_DIR.glob("app_*.db"), reverse=True)
    if not backups:
        return

    now = datetime.now()
    hourly_cutoff = now - timedelta(hours=HOURLY_RETENTION)
    daily_cutoff = now - timedelta(days=DAILY_RETENTION)
    kept_daily = set()
    deleted = 0

    for backup in backups:
        # 解析时间戳
        match = re.match(r"app_(\d{8})_(\d{6})\.db", backup.name)
        if not match:
            continue
        ts_str = match.group(1) + "_" + match.group(2)
        try:
            backup_time = datetime.strptime(ts_str, "%Y%m%d_%H%M%S")
        except ValueError:
            continue

        # 日备份标记（每天 DAILY_HOUR 点的备份）
        day_key = backup_time.strftime("%Y%m%d")
        is_daily = backup_time.hour == DAILY_HOUR and day_key not in kept_daily

        # 判断是否保留
        keep = False
        if is_daily and backup_time > daily_cutoff:
            keep = True
            kept_daily.add(day_key)
        elif backup_time > hourly_cutoff:
            keep = True

        if not keep:
            try:
                backup.unlink()
                deleted += 1
            except OSError as e:
                log(f"删除失败 {backup.name}: {e}")

    if deleted:
        log(f"清理 {deleted} 个过期备份")
    log(f"当前保留 {len(list(BACKUP_DIR.glob('app_*.db')))} 个备份")


def restore_backup(backup_name: str):
    """恢复到指定备份（需手动停止服务后执行）。"""
    backup_path = BACKUP_DIR / backup_name
    if not backup_path.exists():
        # 尝试部分匹配
        candidates = sorted(BACKUP_DIR.glob(f"app_{backup_name}*.db"))
        if not candidates:
            log(f"未找到备份: {backup_name}")
            return
        backup_path = candidates[0]

    log(f"⚠️  即将恢复: {backup_path.name}")
    log(f"⚠️  请先停止后端服务: sudo systemctl stop ai-compliance")
    log(f"⚠️  当前数据库将被覆盖: {APP_DB}")

    # 先备份当前数据库（安全网）
    safety_backup = APP_DB.with_suffix(".db.before_restore")
    shutil.copy2(APP_DB, safety_backup)
    log(f"当前数据库已备份到: {safety_backup.name}")

    shutil.copy2(backup_path, APP_DB)
    log(f"✅ 恢复完成，请重启服务: sudo systemctl start ai-compliance")


def list_backups():
    """列出所有可用备份。"""
    backups = sorted(BACKUP_DIR.glob("app_*.db"), reverse=True)
    if not backups:
        print("无可用备份")
        return

    now = datetime.now()
    print(f"{'备份文件':<30} {'大小':>8}  {'距今':>10}")
    print("-" * 52)
    for backup in backups[:30]:  # 最近 30 个
        size_mb = backup.stat().st_size / 1024 / 1024
        match = re.match(r"app_(\d{8})_(\d{6})\.db", backup.name)
        age = ""
        if match:
            ts = datetime.strptime(match.group(1) + match.group(2), "%Y%m%d%H%M%S")
            delta = now - ts
            if delta.days > 0:
                age = f"{delta.days}天前"
            elif delta.seconds > 3600:
                age = f"{delta.seconds // 3600}小时前"
            else:
                age = f"{max(delta.seconds // 60, 1)}分钟前"
        print(f"{backup.name:<30} {size_mb:>7.1f}MB  {age:>10}")

    total = len(list(BACKUP_DIR.glob("app_*.db")))
    if total > 30:
        print(f"... 共 {total} 个备份")


def main():
    if "--restore" in sys.argv:
        if len(sys.argv) > 2:
            restore_backup(sys.argv[2])
        else:
            list_backups()
        return

    if not APP_DB.exists():
        log(f"⚠️  数据库文件不存在: {APP_DB}")
        return

    checkpoint_wal()
    create_backup()
    cleanup_old_backups()


if __name__ == "__main__":
    main()
