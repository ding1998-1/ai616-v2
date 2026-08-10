# WhisperLiveKit 融合评估

> 日期：2026-08-10 | 项目：https://github.com/QUENTINFUXA/WHISPERLIVEKIT
> 10.5k stars | Python | Apache 2.0 | 活跃维护中

---

## 一、WhisperLiveKit 是什么

超低延迟自托管语音转文字管线，支持多种 ASR 后端。

**核心链路**：
```
麦克风音频 → Silero VAD → 音频分片 → ASR 引擎 → 增量对齐 → WebSocket 推送
                              ↓
                    可选：实时说话人分离 / 翻译
```

**支持的 ASR 后端**：

| 后端 | 说明 | 适合场景 |
|------|------|----------|
| faster-whisper | SimulStreaming / LocalAgreement 策略 | 通用，延迟低 |
| FunASR SenseVoiceSmall | 我们目前用的模型 | 中文好 |
| Qwen3-ASR (vLLM/Streaming) | 因果流式编码器，每秒计算量恒定 | 最新，精度高 |
| Voxtral Mini (4B) | Mistral 出品，100+ 语言自动检测 | 多语言 |
| MLX Whisper | Apple Silicon 原生 | Mac 部署 |

**关键能力**：
- **SimulStreaming**：基于 AlignAtt 策略的同步转写，不等说完再转，延迟更低
- **Silero VAD**：语音活动检测，静音时不消耗 GPU
- **说话人分离**：Sortformer (2025 SOTA) 实时声纹区分
- **增量协议**：`full`（全量）/ `diff`（增量差分）两种推送模式
- **API 兼容**：OpenAI REST API / Deepgram WebSocket / 原生 WebSocket
- **Chrome 扩展**：可捕获网页音频

**安装**：
```bash
pip install whisperlivekit[funasr]  # 用 SenseVoice 后端
wlk --backend funasr --language zh --port 8092
```

---

## 二、我们目前的系统

| 组件 | 方案 |
|------|------|
| 实时 ASR | Paraformer-Large（自研 8 级工业管线：VAD → 音频缓冲 → 推理 → LCP diff → 去重融合 → 句尾检测 → 800ms 静音刷新 → 过期检测） |
| VAD | Silero VAD ✅ |
| 说话人分离 | pyannote 声纹（会后才做，不是实时） |
| 后处理 | Whisper-large-v3 会后高精度转写 + 时间戳对齐 + opencc 繁转简 |
| 流式协议 | 自定义 WebSocket（`/api/meeting/asr/qwen/ws`） |
| 延迟 | ~600ms chunk |
| 中文优化 | 政府热词、同音纠错、标点清洗 |
| 纪要生成 | DeepSeek V3 生成会议纪要/待办/决策 |

---

## 三、对比：我们缺的 vs 它能补的

| 我们缺的 | WhisperLiveKit 能否补上 | 说明 |
|----------|------------------------|------|
| 实时转写延迟再低一点 | ✅ | SimulStreaming 比 Paraformer chunk 方案延迟更低 |
| 实时说话人分离 | ✅ | Sortformer 是 2025 SOTA，我们现在会后才分离 |
| 多模型热切换 | ✅ | 一个服务支持 Whisper/FunASR/Qwen3/Voxtral |
| OpenAI API 兼容 | ✅ | /v1/audio/transcriptions，第三方工具直接对接 |
| 会后高精度转写 | ❌ | 它不做，我们 Whisper 会后重转方案更好 |
| 中文政府热词纠错 | ❌ | 它没有，我们自研的同音替换、政务术语优化是护城河 |
| 会议纪要/待办提取 | ❌ | 它只做转写，DeepSeek 纪要是我们的核心能力 |

---

## 四、融合方案

**不建议整体替换，建议局部融合**：用 WhisperLiveKit 替换自研的 ASR 推理层。

### 架构变化

```
目前：
  前端 → WebSocket → backend_full.py → funasr_asr_server.py (自研 8 级管线)

融合后：
  前端 → WebSocket → backend_full.py → WhisperLiveKit (ASR 引擎)
                                              ↓
                                        SimulStreaming + Sortformer
                                              ↓
                                        我们的后处理（热词纠错、标点清洗）
```

### 实施步骤

1. **装 WhisperLiveKit**：`pip install whisperlivekit[funasr]`（已有 SenseVoice 模型）
2. **启动 ASR 服务**：`wlk --backend funasr --language zh --port 8092`
3. **改 backend_full.py**：把 `/api/meeting/asr/qwen/ws` 的 ASR 调用指向 WhisperLiveKit
4. **保留后处理**：热词纠错、LCP diff、标点清洗继续跑在 backend 层
5. **保留会后流程**：Whisper-large-v3 高精度重转 + DeepSeek 纪要生成不动

### 收益与代价

| 收益 | 代价 |
|------|------|
| 延迟更低 | 需要适配 WebSocket 协议 |
| 实时说话人分离 | 自研 8 级管线要拆掉一部分 |
| 多模型可选 | 新增依赖，环境管理更复杂 |
| 社区维护，持续更新 | 需要测试稳定性 |

---

## 五、待办

- [ ] 在测试环境安装 WhisperLiveKit，跑 FunASR 后端
- [ ] 对比延迟和准确率（同一条录音，现有方案 vs WhisperLiveKit）
- [ ] 测试实时说话人分离效果
- [ ] 评估 WebSocket 协议兼容性
- [ ] 决定是否融合，制定实施计划
