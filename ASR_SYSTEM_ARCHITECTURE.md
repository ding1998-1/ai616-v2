# AI 会议系统 — 本地 ASR 架构文档

## 1. 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│  手机浏览器 (MobileMeetingRecorder.jsx)                     │
│  - 采集麦克风 16kHz mono int16 PCM                         │
│  - 每 ~375ms 打包一批通过 WebSocket 发送                    │
│  - 接收 WS 消息：type: "final" → postTranscript 入库       │
└──────────────────────┬──────────────────────────────────────┘
                       │ WebSocket (wss://host/api/meeting/asr/qwen/ws)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  ai-compliance 后端 (backend_full.py:3781)                  │
│  meeting_asr_qwen_websocket()                               │
│  - 认证 + 创建 ASR session                                  │
│  - 音频转发 → QwenASRClient (HTTP to localhost:8091)       │
│  - _fuzzy_lcp() 增量提取（容错同音字修正）                  │
│  - 缓冲 ≥6 字或句尾标点 → 发送 "final" 到手机               │
│  - 800ms 静默 → 强制提交                                    │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP POST /api/chunk?session_id=X
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  FunASR SenseVoiceSmall 服务 (funasr_asr_server.py)         │
│  GPU 1 | conda: funasr-sensevoice | port 8091              │
│  - 每会话独立 cache 字典（FunASR 流式状态管理）             │
│  - 非自回归模型（CTC），每次只传当前切片                    │
│  - cache 内部管理 VAD 状态，自动过滤静音/重复               │
└─────────────────────────────────────────────────────────────┘
```

## 2. 源文件清单

| 文件 | 位置 | 行数 | 作用 |
|------|------|------|------|
| `funasr_asr_server.py` | `/home/ai/桌面/` | 217 | **ASR 服务端**，SenseVoiceSmall 流式识别 |
| `qwen_asr_client.py` | `/home/ai/文档/ai616/backend/` | 129 | **后端 HTTP 客户端**，封装 start/chunk/finish |
| `backend_full.py` (行 3781-4022) | `/home/ai/文档/ai616/` | ~240 | **WebSocket 处理**，含 LCP 增量 + 双轨断句 |
| `MobileMeetingRecorder.jsx` (行 480-620) | `/home/ai/文档/ai616/frontend/src/pages/` | ~140 | **前端录音**，WS 连接 + 音频采集 |
| `funasr-asr.service` | `/home/ai/文档/ai616/` | 16 | **systemd 服务** |
| `switch_to_funasr.sh` | `/home/ai/文档/ai616/` | 35 | **一键切换脚本** |

## 3. 核心源码

### 3.1 ASR 服务端 (`funasr_asr_server.py`)

**文件位置**: `/home/ai/桌面/funasr_asr_server.py`

**Conda 环境**: `funasr-sensevoice` (Python 3.12, FunASR 1.3.14, PyTorch 2.x)

**启动命令**:
```bash
conda activate funasr-sensevoice
python funasr_asr_server.py --model /home/ai/.cache/modelscope/hub/models/iic/SenseVoiceSmall \
                            --host 0.0.0.0 --port 8091 --device cuda:1
```

**核心结构**:

```python
# 会话管理 — 每会话独立 cache
@dataclass
class Session:
    cache: dict = field(default_factory=dict)  # FunASR 流式状态
    current_text: str = ""                     # 当前句最新文本
    chunk_count: int = 0
    last_active_time: float = 0.0

# 模型加载（lifespan 启动时）
asr_model = AutoModel(
    model="/home/ai/.cache/modelscope/hub/models/iic/SenseVoiceSmall",
    device="cuda:1",
)

# 流式 chunk — 仅传当前切片 + 会话 cache
@app.post("/api/chunk")
async def api_chunk(request, session_id):
    raw = await request.body()  # 仅当前切片（不累积）
    result = asr_model.generate(
        input=raw,
        cache=s.cache,        # 会话专属，管理流式状态
        language="zh",
        use_itn=True,
        is_final=False,       # 非最终句
    )
    return {"text": result[0].get("text", "")}

# 强制切句 — is_final=True
@app.post("/api/finish")
async def api_finish(session_id):
    result = asr_model.generate(
        input=b"",            # 空输入强制输出
        cache=s.cache,
        is_final=True,        # 最终句
    )
    return {"text": result[0].get("text", "")}
```

**API 接口**:

| 方法 | 路径 | 参数 | 返回 |
|------|------|------|------|
| GET | `/api/health` | — | `{"status":"ok", "model":"SenseVoiceSmall", "backend":"funasr-v2"}` |
| POST | `/api/start` | — | `{"session_id": "..."}` |
| POST | `/api/chunk` | `?session_id=X`, body=PCM int16 | `{"text":"...", "language":"zh", "chunk_id":N}` |
| POST | `/api/finish` | `?session_id=X` | `{"text":"...", "language":"zh", "chunk_id":N, "audio_chunks":N}` |
| GET | `/api/session/{id}` | — | 会话调试信息 |

### 3.2 后端 ASR 客户端 (`backend/qwen_asr_client.py`)

**文件位置**: `/home/ai/文档/ai616/backend/qwen_asr_client.py`

```python
class QwenASRClient:
    """Qwen3-ASR 流式转录服务客户端 — 兼容 FunASR SenseVoiceSmall"""

    def __init__(self, base_url="http://127.0.0.1:8091", timeout=10.0):
        self.base_url = base_url.rstrip("/")

    async def health(self) -> Dict:
        """GET /api/health → 检查服务可用性"""
        r = await client.get(f"{self.base_url}/api/health")
        return r.json()

    async def is_available(self) -> bool:
        """服务是否可用"""
        ...

    async def start(self) -> str:
        """POST /api/start → 返回 session_id"""
        ...

    async def send_chunk(self, session_id: str, audio_bytes: bytes) -> Dict:
        """POST /api/chunk → 发送音频块进行增量识别"""
        ...

    async def finish(self, session_id: str) -> Dict:
        """POST /api/finish → 结束识别，返回最终结果"""
        ...
```

### 3.3 WebSocket 处理 (`backend_full.py` 行 3781-4022)

**函数**: `meeting_asr_qwen_websocket(websocket: WebSocket)`

**核心逻辑**:

```python
async def meeting_asr_qwen_websocket(websocket):
    # 1. 认证
    user = _get_user_from_auth_token(token, required=True)

    # 2. 创建 Qwen3-ASR 会话（实际指向 FunASR）
    qwen_client = QwenASRClient(base_url=QWEN_ASR_URL)  # → port 8091
    session_id = await qwen_client.start()

    # 3. 音频转发循环
    while True:
        audio_bytes = await websocket.receive()  # 接收手机端二进制帧
        result = await qwen_client.send_chunk(session_id, audio_bytes)

        text = result.get("text", "").strip()
        if text and text != last_full_text:
            # 模糊 LCP — 容错同音字修正（2字容差）
            prefix_len = _fuzzy_lcp(committed_text, text, tolerance=2)
            new_content = text[prefix_len:]

            # 缓冲有成句 → 发送 final 到手机
            if sentence_end and len(pending_buffer) >= 6:
                websocket.send_json({
                    "type": "final",
                    "newText": send_text,    # 增量文本
                    "fullText": text,        # 完整文本
                })

            # 800ms 静默 → 强制提交
            if time.monotonic() - last_change_time > 0.8:
                websocket.send_json({"type": "final", "newText": pending_buffer})

        # 4. 结束 → flush 缓冲
        final = await qwen_client.finish(session_id)
```

**关键函数**:

- `_fuzzy_lcp(a, b, tolerance=2)` — 容错同音字的前缀匹配
  ```python
  # "我们开会讨论" vs "我们开会统筹" → 仍能正确对齐
  def _fuzzy_lcp(a, b, tolerance=2):
      n, mismatches = min(len(a), len(b)), 0
      i = 0
      while i < n:
          if a[i] != b[i]:
              mismatches += 1
              if mismatches > tolerance:
                  return i - mismatches + 1
          i += 1
      return i
  ```

### 3.4 前端录音 (`MobileMeetingRecorder.jsx` 行 480-620)

**音频采集**:
```javascript
// 麦克风 → 16kHz PCM
const processor = audioContext.createScriptProcessor(4096, 1, 1);
processor.onaudioprocess = event => {
    const input = event.inputBuffer.getChannelData(0);
    const downsampled = downsampleTo16k(input, audioContext.sampleRate);
    // 攒 ~375ms 一批发送
    audioBuffer = concat(audioBuffer, floatToPcm16(downsampled));
    if (audioBuffer.length >= 12000) {
        currentSocket.send(audioBuffer.buffer);
        audioBuffer = new Uint8Array(0);
    }
};
```

**WS 消息处理**:
```javascript
socket.onmessage = event => {
    const payload = JSON.parse(event.data);

    if (payload.type === 'final') {
        // 新协议：newText 是不重叠增量
        postTranscript(payload.newText, true);
    }

    if (payload.type === 'result') {
        // 兼容旧 Fun-ASR 协议
        if (payload.isFinal) postTranscript(payload.text, true);
        else setInterimText(payload.text);
    }
};
```

**ASR 后端选择**:
```javascript
// 前端切换按钮
const [asrBackend, setAsrBackend] = useState(
    () => localStorage.getItem('ai616_asr_backend') || 'dashscope'
);

// 根据选择决定 WS 路径
const wsPath = asrBackend === 'qwen'
    ? '/api/meeting/asr/qwen/ws'    // → FunASR SenseVoiceSmall (本地)
    : '/api/meeting/asr/ws';        // → DashScope Fun-ASR (云端)
```

## 4. 运行环境

| 组件 | 环境 | GPU | 端口 |
|------|------|-----|------|
| FunASR SenseVoiceSmall | `conda: funasr-sensevoice` | GPU 1 (6.4GB) | 8091 |
| ai-compliance 后端 | `conda: ai_compliance` | GPU 0 (1.7GB) | 8002 |
| nginx | 系统 | — | 80 |

**依赖**: funasr==1.3.14, torch==2.12.1, torchaudio==2.11.0, fastapi, uvicorn

**模型**: SenseVoiceSmall, 897MB, 支持中英日韩粤语, 非自回归 CTC 架构

## 5. 流式识别原理

```
v1 (已废弃):  累积全部历史音频 → 模型重复识别 → 文本鬼畜叠加
              chunk1: audio[A]       → "我觉得还可以"
              chunk2: audio[A+B]     → "我觉得还可以我觉得还可以"
              chunk3: audio[A+B+C]   → "我觉得还可以我觉得还可以我还可以可以..."

v2 (当前):   每次仅传当前切片 + cache → 模型内部状态管理 → 文本不重复
              chunk1: audio[A] + cache → "我觉得"
              chunk2: audio[B] + cache → "我觉得还可以"
              chunk3: audio[C] + cache → "我觉得还可以不错"
              finish: b"" + is_final   → "我觉得还可以不错" (最终句)
```

## 6. 部署与维护

```bash
# 一键切换
sudo /home/ai/文档/ai616/switch_to_funasr.sh

# 查看状态
curl http://127.0.0.1:8091/api/health | python3 -m json.tool
journalctl -u funasr-asr -f

# 手动启动/重启
sudo systemctl restart funasr-asr

# GPU 监控
watch -n 1 nvidia-smi
```
