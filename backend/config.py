"""
backend/config.py — 全局配置、路径常量、锁、缓存、工具函数

依赖: 无（只依赖标准库 + python-dotenv）
被依赖: db.py, llm_client.py, routes/*, main.py
"""

import os
import socket
import asyncio
import concurrent.futures
import time
import threading
from threading import Lock, RLock
from pathlib import Path
from urllib.parse import urlparse
from typing import Optional, Dict
from dotenv import load_dotenv

load_dotenv()

# ═══ 环境变量 ═══════════════════════════════════════════════════════════════════

LLM_CONCURRENCY = int(os.environ.get("LLM_CONCURRENCY", "5"))
AUTH_SECRET = os.environ.get("APP_AUTH_SECRET", "")
DASHSCOPE_FUN_ASR_WS_URL = os.environ.get(
    "DASHSCOPE_FUN_ASR_WS_URL", "wss://dashscope.aliyuncs.com/api-ws/v1/inference"
)
DASHSCOPE_API_KEY = (
    os.environ.get("DASHSCOPE_API_KEY")
    or os.environ.get("DASHSCOPE_BAILIAN_API_KEY")
    or os.environ.get("BAILIAN_API_KEY")
    or ""
)
DASHSCOPE_WORKSPACE = (
    os.environ.get("DASHSCOPE_WORKSPACE") or os.environ.get("DASHSCOPE_WORKSPACE_ID") or ""
)
PERSIST_DIR = str(Path(os.path.dirname(os.path.abspath(__file__))) / ".." / "chroma_db")

# ═══ 目录与文件路径 ══════════════════════════════════════════════════════════════

def _script_dir() -> Path:
    return Path(os.path.dirname(os.path.abspath(__file__))).parent

CUSTOM_RULES_DIR = _script_dir() / "data" / "custom_rules"
CUSTOM_RULES_DIR.mkdir(parents=True, exist_ok=True)
CUSTOM_RULES_DB = CUSTOM_RULES_DIR / "files.json"

MEETING_DATA_DIR = _script_dir() / "data" / "meetings"
MEETING_DATA_DIR.mkdir(parents=True, exist_ok=True)

APP_DB = _script_dir() / "data" / "app.db"
MEETING_FILES_DIR = _script_dir() / "data" / "meeting_files"
MEETING_FILES_DIR.mkdir(parents=True, exist_ok=True)

RULES_IMAGES_DIR = _script_dir() / "rules"

AUTH_DATA_DIR = _script_dir() / "data" / "auth"
AUTH_DATA_DIR.mkdir(parents=True, exist_ok=True)
USERS_DB = AUTH_DATA_DIR / "users.json"
DEPARTMENTS_DB = AUTH_DATA_DIR / "departments.json"

ASR_CONFIG_DIR = _script_dir() / "data" / "asr"
ASR_CONFIG_DIR.mkdir(parents=True, exist_ok=True)
ASR_HOTWORDS_DB = ASR_CONFIG_DIR / "hotwords.json"
ASR_CORRECTIONS_DB = ASR_CONFIG_DIR / "corrections.json"

MEETINGS_DB = MEETING_DATA_DIR / "meetings.json"
MEETING_TRANSCRIPTS_DB = MEETING_DATA_DIR / "transcripts.json"

# ═══ 锁 — 保护共享状态 ═══════════════════════════════════════════════════════════

APP_DB_LOCK = RLock()                 # SQLite 写操作互斥锁（可重入）
MEETINGS_LOCK = Lock()                # 会议全量读写锁（仅旧代码路径使用）
MEETING_TRANSCRIPTS_LOCK = Lock()     # 转写全量读写锁（仅旧代码路径使用）

# ═══ 全局对象 — LLM / HTTP ═══════════════════════════════════════════════════════

llm_semaphore = asyncio.Semaphore(LLM_CONCURRENCY)
_llm_executor = concurrent.futures.ThreadPoolExecutor(max_workers=8, thread_name_prefix="llm-")

# ═══ 会议内存缓存 — 2s TTL，上限 500 条 ══════════════════════════════════════════

_meetings_cache: Optional[dict] = None
_meetings_cache_time: float = 0.0
_meetings_cache_ttl: float = 2.0
_meetings_cache_max_keys: int = 500

# ═══ 转写内存缓存 — 1s TTL，上限 50 会议 / 5000 条 ═════════════════════════════════

_transcripts_cache: Optional[dict] = None
_transcripts_cache_time: float = 0.0
_transcripts_cache_ttl: float = 1.0
_transcripts_cache_max_keys: int = 50
_transcripts_cache_max_rows: int = 5000

# ═══ WAL checkpoint — 防 WAL 文件无限增长 ═════════════════════════════════════════

_WAL_CHECKPOINT_INTERVAL = 300  # 秒
_last_wal_checkpoint: float = 0.0

# ═══ 上传限制 ═════════════════════════════════════════════════════════════════════

MAX_UPLOAD_BYTES = 100 * 1024 * 1024   # 通用上传 100MB
MAX_AUDIO_BYTES = 80 * 1024 * 1024     # 录音 80MB
MAX_EXCEL_BYTES = 20 * 1024 * 1024     # Excel 导入 20MB

# ═══ Qwen3-ASR 本地服务 ═════════════════════════════════════════════════════════════

QWEN_ASR_URL = os.environ.get("QWEN_ASR_URL", "http://127.0.0.1:8091")
# ASR_BACKEND: "auto" (优先本地 Qwen，不可用时降级 Fun-ASR),
#   "qwen" (仅本地 Qwen), "dashscope" (仅 Fun-ASR)
ASR_BACKEND = os.environ.get("ASR_BACKEND", "auto")

# ═══ ASR 重连参数 ═════════════════════════════════════════════════════════════════

ASR_RECONNECT_BASE_DELAY = 1.0   # 初始重连延迟（秒）
ASR_RECONNECT_MAX_DELAY = 16.0   # 指数退避上限
ASR_RECONNECT_MAX_RETRIES = 5    # 单次连接窗口内最大重试

# ═══ 网络工具 ═════════════════════════════════════════════════════════════════════

def get_public_host() -> str:
    """自动检测局域网 IP，失败回退 localhost。"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "localhost"


PUBLIC_HOST = get_public_host()


def get_browser_backend_base(request) -> str:
    """根据请求头构建浏览器可达的后端 URL，用于 OnlyOffice 插件加载。"""
    override = os.environ.get("PUBLIC_BASE_URL")
    if override:
        return override.rstrip("/")

    scheme = request.headers.get("x-forwarded-proto") or request.url.scheme or "http"
    host = None

    for header_name in ("origin", "referer"):
        value = request.headers.get(header_name)
        if not value:
            continue
        parsed = urlparse(value)
        if parsed.hostname:
            host = parsed.hostname
            if parsed.scheme:
                scheme = parsed.scheme
            break

    if not host:
        forwarded_host = request.headers.get("x-forwarded-host")
        if forwarded_host:
            host = forwarded_host.split(",")[0].strip().split(":")[0]

    if not host:
        raw_host = request.headers.get("host", "")
        if raw_host:
            host = raw_host.split(":")[0]

    if not host:
        host = PUBLIC_HOST

    return f"{scheme}://{host}:8000"


def now_text() -> str:
    """当前时间字符串，格式 YYYY-MM-DD HH:MM:SS。"""
    from datetime import datetime
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def today_text() -> str:
    """当天日期字符串，格式 YYYY-MM-DD。"""
    from datetime import datetime
    return datetime.now().strftime("%Y-%m-%d")


# ═══ SSE 连接管理 — 按 meeting_id 管理订阅者队列 ═══════════════════════════════════

class SSEManager:
    """轻量级发布/订阅：每个会议维护一个 asyncio.Queue 广播列表。"""

    def __init__(self):
        self._queues: dict = {}  # meeting_id -> list[asyncio.Queue]

    def subscribe(self, meeting_id: str):
        """为指定会议注册一个新队列，调用方从这个队列读取 SSE 事件。"""
        q: asyncio.Queue = asyncio.Queue(maxsize=256)
        self._queues.setdefault(meeting_id, []).append(q)
        return q

    def unsubscribe(self, meeting_id: str, q):
        """移除队列，清理空列表。"""
        queues = self._queues.get(meeting_id)
        if queues and q in queues:
            queues.remove(q)
        if not queues:
            self._queues.pop(meeting_id, None)

    async def publish(self, meeting_id: str, event_type: str, data: dict):
        """向所有订阅该会议的队列推送事件。"""
        queues = self._queues.get(meeting_id, [])
        if not queues:
            return
        payload = {"type": event_type, "data": data}
        dead = []
        for q in queues:
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                dead.append(q)
        for q in dead:
            self.unsubscribe(meeting_id, q)


sse_manager = SSEManager()
