# AI 会议录音转写架构

> 日期：2026-07-01  
> 模型：Paraformer-Large（流式）+ Whisper-large-v3（兜底）  
> GPU：NVIDIA RTX 4090 × 2（GPU0: ChromaDB，GPU1: 双ASR模型）

---

## 一、架构总览

```
┌──────────────────────────────────────────────────────────────────┐
│                        iPhone / Android                          │
│  getUserMedia → AudioContext(16kHz) → ScriptProcessor(8192)      │
│       │                    │                    │                │
│       ▼                    ▼                    ▼                │
│  MediaRecorder       floatToPcm16          WebSocket             │
│  (音频分片上传)      (噪声门+AGC)         (PCM 实时流)            │
└───────┬────────────────────┬────────────────────┬────────────────┘
        │ webm 分片上传       │ PCM int16 流        │ WS binary
        ▼                    │                    ▼
┌───────────────────────────┴──────────────────────────────────────┐
│                    nginx (aimeeting.xingsnb.cn:443)               │
│         /api/meeting/recorder/audio    /api/meeting/asr/qwen/ws  │
└───────────────────────────┬──────────────────────┬───────────────┘
                            │                      │
                            ▼                      ▼
┌──────────────────────────────────────────────────────────────────┐
│                    backend_full.py (8002, GPU0)                   │
│                                                                   │
│  ┌─ 音频上传 ─────────────────────────────────────────────┐      │
│  │  /api/meeting/recorder/audio → 存 webm 到 meeting_files │      │
│  └────────────────────────────────────────────────────────┘      │
│                                                                   │
│  ┌─ 实时转写 WebSocket ────────────────────────────────────┐     │
│  │  /api/meeting/asr/qwen/ws                                │     │
│  │                                                          │     │
│  │  ┌───────────┐  ┌──────────┐  ┌───────────┐  ┌───────┐ │     │
│  │  │ Energy    │→│ VAD-lite │→│ 600ms     │→│Send   │ │     │
│  │  │ Gate      │  │ (ZCR)    │  │ 滑动缓冲  │  │Chunk  │ │     │
│  │  │ RMS+Peak  │  │ 0.03~0.55│  │ 19200B    │  │       │ │     │
│  │  └───────────┘  └──────────┘  └───────────┘  └───┬───┘ │     │
│  │                                                   │      │     │
│  │  ┌───────────┐  ┌──────────┐  ┌───────────┐      │      │     │
│  │  │ 重复Token │←│ LCP      │←│ Paraformer│←─────┘      │     │
│  │  │ 熔断器    │  │ 像素裁剪  │  │ HTTP POST │              │     │
│  │  └─────┬─────┘  └────┬─────┘  │ :8091     │              │     │
│  │        │              │        └───────────┘              │     │
│  │        ▼              ▼                                   │     │
│  │  ┌───────────┐  ┌──────────┐                             │     │
│  │  │ 800ms     │  │ Preview  │ → 前端实时上屏               │     │
│  │  │ 超时切句  │  │ + Final  │                             │     │
│  │  └───────────┘  └──────────┘                             │     │
│  └──────────────────────────────────────────────────────────┘     │
│                                                                   │
│  ┌─ 录音停止 → Whisper 终审 ───────────────────────────────┐     │
│  │  session action=stop                                      │     │
│  │    → 合并所有 webm → ffmpeg → PCM                         │     │
│  │    → POST /api/transcribe → Whisper-large-v3              │     │
│  │    → 保存为 whisper-review 事件                            │     │
│  │    → DeepSeek docx 生成时自动注入                          │     │
│  └──────────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│               funasr_asr_server.py (8091, GPU1)                   │
│                                                                   │
│  ┌─ Paraformer-Large（流式，600ms chunk）──────────────────┐     │
│  │  beam_size=10  chunk_size=[10,10,5]                      │     │
│  │  + CT-Punc（标点） + CAM++（说话人分离）                  │     │
│  └──────────────────────────────────────────────────────────┘     │
│                                                                   │
│  ┌─ Whisper-large-v3（兜底，非流式）───────────────────────┐     │
│  │  /api/transcribe → 全量音频一次性推理                     │     │
│  │  465秒音频 → 4秒推理（116x 实时）                         │     │
│  └──────────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────┘
```

---

## 二、音频处理流水线（8 级）

### Stage 1：动态 Energy Gate（RMS + Peak 联合）
```
位置：backend_full.py _energy_gate()
阈值：RMS [120, 250] 自适应，默认 180
      Peak ≥ 400 OR RMS ≥ 阈值 → 放行
      RMS < 阈值 AND Peak < 400 → 拦截（物理静音/呼吸/摩擦）
```
- 阈值自适应：RMS < 50 → 降门槛（+5），RMS > 300 → 升门槛（-5）
- 结合 ZCR（过零率）双重判定：噪声即使有能量，ZCR 不过也拦截

### Stage 2：VAD-lite（过零率语音检测）
```
ZCR = 过零次数 / 采样点数
0.03 < ZCR < 0.55 → 人声，放行
ZCR < 0.03（直流偏移）或 > 0.55（高频噪声）→ 拦截
```

### Stage 3：600ms 滑动缓冲区
```
前端发 250ms 碎片包（AUDIO_BATCH_BYTES=8000）
后端积攒到 19200 bytes（9600 samples = 600ms）
对齐 Paraformer chunk 帧长，减少碎片化推理
```

### Stage 4：SeACO-Paraformer 流式推理
```
POST /api/chunk → Paraformer.generate()
beam_size=10, chunk_size=[10,10,5]
cache 保持跨 chunk 连续，实现 300-600ms 延迟实时输出
```

### Stage 5：LCP 像素级裁剪（committed_text 同生共死）
```
prefix_len = _fuzzy_lcp(committed_text, clean_text, tolerance=2)
new_content = clean_text[prefix_len:]
→ committed_text 与 GPU session_id 同生共死
→ GPU 不重置，committed_text 绝不单独清零
→ 历史文本永不会倒灌
```

### Stage 6：重复 Token 级联熔断器
```
规则 A：正则 (.)\1{5,} → 连续 6 个相同汉字 → finish + start 重启
规则 B：连续 3 帧相同完整文本 → finish + start 重启
```

### Stage 7：流式失活检测
```
连续 30 chunks 无新字 → finish + start 重启
防止长会话 cache 失活
```

### Stage 8：800ms 超时切句
```
独立 monitor 协程，每 0.2s 检查
超时 → 发 type:"final" → finish + start 硬切断
committed_text、ui_bubble_start_idx 同步归零
```

---

## 三、状态机：同生共死定理

### 动作 A — 800ms 静音（硬切断）
```
finish(session_id) + start()     ← GPU 重置，cache 清零
committed_text = ""               ← Python 同步归零
last_full_text = ""
ui_bubble_start_idx = 0
→ 白纸重开，绝不拖泥带水
```

### 动作 B — 遇标点  。？！…（软切句）
```
发 type:"final"（从 ui_bubble_start_idx 到当前）
ui_bubble_start_idx = len(clean_text)  ← 只移游标
committed_text = clean_text             ← 更新锚点，不归零
→ GPU 继续跑，气泡精准分段，历史绝不倒灌
```

### 延迟启动 ASR
```
连接 → 发 ready → 等首次语音检测 → 才 start()
避免环境噪声被无 VAD 的 Paraformer 幻觉成"对对对"
```

---

## 四、双模型对比

| | Paraformer-Large（流式） | Whisper-large-v3（兜底） |
|------|------|------|
| **模式** | 流式（600ms chunk 增量） | 非流式（全量一次性） |
| **延迟** | 300-600ms | 事后处理 |
| **速度** | 实时 | 465s → 4s（116x 实时） |
| **精度** | 中等（实时场景优化） | 高（全量上下文） |
| **GPU 内存** | ~6GB | ~3GB |
| **VAD** | 无（前端 Energy Gate） | 内置 |
| **标点** | CT-Punc | 内置 |
| **说话人** | CAM++ | 不支持 |
| **触发时机** | 录音中实时 | 录音停止后自动 |
| **用途** | 会议现场即时显示 | 会后终审、docx 生成 |

---

## 五、前端音频处理

### 录音链路
```
getUserMedia({audio:true})
  → AudioContext({sampleRate:16000})
    → createScriptProcessor(8192, 1, 1)  // 1进1出，单声道
      → onaudioprocess:
          ① downsampleTo16k (已16kHz则跳过)
          ② floatToPcm16:
             - 噪声门: RMS < 0.5% → 丢弃
             - AGC: targetRms=0.2, maxGain=5x
             - Float32 → Int16 LE PCM
          ③ 缓冲累积到 8000 bytes (~250ms) → WS.send()
```

### 音频参数
| 参数 | 值 |
|------|-----|
| 采样率 | 16000 Hz |
| 位深 | 16-bit |
| 声道 | 单声道 |
| 字节序 | Little-Endian |
| 帧大小 | 8192 samples (~512ms) |
| 发包大小 | 8000 bytes (~250ms) |

---

## 六、WebSocket 消息协议

### 后端 → 前端

| type | 字段 | 时机 | 说明 |
|------|------|------|------|
| `ready` | taskId, meetingId, speaker, backend | 连接建立 | 前端开始发音频 |
| `preview` | text, isFinal:false, spk | 每次有新文本 | 绿色预览框实时显示 |
| `final` | newText, fullText, isFinal:true, spk | 标点或≥6字提交 | 入库气泡 |
| `finished` | taskId | 会话结束 | 识别完成 |
| `error` | message | 异常 | 错误信息 |

### 前端 → 后端

| type | 格式 | 说明 |
|------|------|------|
| binary | Int16 PCM | 音频流（~250ms/包） |
| `finish` | JSON text | 结束识别 |

---

## 七、关键参数速查

### ASR 模型（funasr_asr_server.py）
| 参数 | 值 |
|------|-----|
| model | Paraformer-Large (speech_seaco) |
| beam_size | 10 |
| chunk_size | [10, 10, 5]（600ms左上下文 + 600ms块 + 300ms前瞻） |
| punc_model | ct-punc |
| spk_model | cam++ |
| device | cuda:1 |

### 音频前端（MobileMeetingRecorder.jsx）
| 参数 | 值 |
|------|-----|
| TARGET_SAMPLE_RATE | 16000 |
| AGC targetRms | 0.2 |
| AGC maxGain | 5.0 |
| 噪声门 RMS | < 0.5% |
| ScriptProcessor buffer | 8192 |
| AUDIO_BATCH_BYTES | 8000 (~250ms) |

### 后端流水线（backend_full.py）
| 参数 | 值 |
|------|-----|
| ASR_CHUNK_BYTES | 19200 (~600ms) |
| Energy Gate 阈值 | 180（自适应 [120, 250]） |
| Energy Gate Peak | 400 |
| VAD-lite ZCR | 0.03 ~ 0.55 |
| 静默超时 | 800ms |
| 失活检测 | 30 chunks |
| 熔断A（正则） | (.)\1{5,} |
| 熔断B（连续帧） | 3帧 |
| LCP tolerance | 2 |

---

## 八、服务部署

### 端口分配
| 服务 | 端口 | GPU | 模型 |
|------|------|-----|------|
| paraformer-asr | 8091 | cuda:1 | Paraformer + Whisper |
| ai-compliance | 8002 | cuda:0 | Backend + ChromaDB |
| nginx | 80/443 | - | 静态文件 + 反代 |

### GPU 内存
```
GPU 0: 853MB  (ChromaDB + SentenceTransformer)
GPU 1: 9.2GB  (Paraformer 6GB + Whisper 3GB + CAM++ + CT-Punc)
```

### 开机自启
```bash
systemctl enable paraformer-asr   # ✅
systemctl enable ai-compliance    # ✅
```

### 关键命令
```bash
# 重启 ASR（双模型）
sudo systemctl restart paraformer-asr
# 或手动
kill $(pgrep -f funasr_asr_server)
nohup /home/ai/miniconda3/envs/funasr-sensevoice/bin/python /home/ai/桌面/funasr_asr_server.py --device cuda:1 > /tmp/asr.log 2>&1 &

# 重启后端
sudo /home/ai/文档/ai616/restart_safe.sh

# 构建前端
cd /home/ai/文档/ai616/frontend && npm run build

# 健康检查
curl http://127.0.0.1:8091/api/health   # ASR
curl http://127.0.0.1:8002/health       # 后端
```

---

## 九、已知限制

1. **iPhone 麦克风电平极低**（原始 peak 2.3%）→ 依赖 AGC 5x 增益补偿
2. **FSMN-VAD 不可用**（全量误判）→ 已移除，前端 Energy Gate 替代
3. **asyncio.to_thread() CUDA 不兼容** → 已回滚，同步 generate()
4. **AudioWorklet iOS 输出异常** → 已回退 ScriptProcessor
5. **GLM-ASR-Nano-2512 非流式** → 已下载但未启用，保留备用
6. **双进程竞争端口** → 重启前需全杀

---

## 十、修改记录索引

| 日期 | 文件 | 说明 |
|------|------|------|
| 2026-07-01 | `2026-07-01 修改记录.md` | 全量修改记录 |
| 2026-07-01 | `2026-07-01 AI会议源码架构与问题排查报告.md` | 7个架构修复 + 排查过程 |
| 2026-07-01 | 本文 | 录音架构总览 |
