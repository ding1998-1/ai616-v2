"""Whisper 本地转写模块 — 高精度录音文件转写。

使用 openai-whisper 进行批量转写，模型从 ModelScope 缓存加载。
用于会后终审：录音文件 → Whisper 全量转写 → 结构化结果。

Whisper 中文模型默认输出繁体，使用 opencc 自动转换为简体。
"""
import logging
import tempfile
import subprocess
from pathlib import Path

import numpy as np

logger = logging.getLogger(__name__)

_model = None
_converter = None


def _get_converter():
    """懒加载 opencc 繁简转换器（t2s = 繁体→简体）。"""
    global _converter
    if _converter is None:
        try:
            import opencc
            _converter = opencc.OpenCC('t2s')
            logger.info("opencc 繁简转换器已加载")
        except ImportError:
            logger.warning("opencc 未安装，繁简转换不可用。pip install opencc-python-reimplemented")
            _converter = False
    return _converter

# ModelScope 缓存的 Whisper large-v3 模型路径
_MODELSCOPE_MODEL = "/home/ai/.cache/modelscope/hub/models/iic/Whisper-large-v3/large-v3.pt"


def _get_model():
    """懒加载 Whisper 模型（openai-whisper），固定使用 GPU 1。"""
    global _model
    if _model is not None:
        return _model

    import whisper
    import os

    # 固定使用 GPU 1，避免与 ASR (GPU 0) 争抢显存
    whisper_gpu = os.environ.get("WHISPER_GPU", "1")
    device = f"cuda:{whisper_gpu}"
    logger.info("Whisper 将使用设备: %s", device)

    model_path = _MODELSCOPE_MODEL
    if not Path(model_path).exists():
        # 回退：尝试从 HuggingFace 下载
        logger.warning("ModelScope 模型不存在: %s，尝试从 HuggingFace 加载", model_path)
        model_path = "large-v3"

    logger.info("加载 Whisper 模型: %s → %s (首次加载约需 30s)", model_path, device)
    _model = whisper.load_model(model_path, device=device)
    logger.info("Whisper 模型加载完成 (%s)", device)
    return _model


def transcribe_file(
    audio_path: str,
    model_size: str = "large-v3",
    language: str = "zh",
    beam_size: int = 5,
    vad_filter: bool = True,
    vad_threshold: float = 0.5,
) -> dict:
    """转写音频文件，返回结构化结果。

    Args:
        audio_path: 音频文件路径 (webm/wav/mp3/mp4)
        model_size: Whisper 模型大小 (unused, 固定使用 large-v3)
        language: 语言代码 (zh/en/auto)
        beam_size: beam search 大小 (unused, openai-whisper 使用默认值)
        vad_filter: 是否启用 VAD 过滤静音 (unused)
        vad_threshold: VAD 阈值 (unused)

    Returns:
        {
            "text": "完整转写文本",
            "segments": [{"start": 0.0, "end": 2.5, "text": "..."}, ...],
            "language": "zh",
            "duration": 120.5
        }
    """
    model = _get_model()

    lang_param = None if language == "auto" else language

    try:
        result = model.transcribe(
            audio_path,
            language=lang_param,
            verbose=False,
        )

        # 繁简转换：Whisper 中文模型默认输出繁体，转为简体
        converter = _get_converter()

        def _to_simplified(text: str) -> str:
            if converter and converter is not False:
                return converter.convert(text)
            return text

        segments = []
        for seg in result.get("segments", []):
            segments.append({
                "start": round(seg["start"], 2),
                "end": round(seg["end"], 2),
                "text": _to_simplified(seg["text"].strip()),
            })

        full_text = _to_simplified(result.get("text", "").strip())
        detected_lang = result.get("language", language)

        # 估算时长
        duration = segments[-1]["end"] if segments else 0.0

        logger.info(
            "Whisper 转写完成: %s, %d 段, %.1fs 时长, 语言=%s",
            audio_path, len(segments), duration, detected_lang,
        )

        return {
            "text": full_text,
            "segments": segments,
            "language": detected_lang,
            "duration": duration,
        }

    except Exception as e:
        logger.error("Whisper 转写失败: %s", e, exc_info=True)
        raise


def transcribe_pcm(
    pcm_data: bytes | np.ndarray,
    sample_rate: int = 16000,
    model_size: str = "large-v3",
    language: str = "zh",
) -> dict:
    """转写 PCM 音频数据（内存中）。

    先保存为临时 WAV 文件，再调用 transcribe_file。
    """
    if isinstance(pcm_data, bytes):
        audio_array = np.frombuffer(pcm_data, dtype=np.int16).astype(np.float32) / 32768.0
    else:
        audio_array = pcm_data.astype(np.float32)

    # 保存为临时 WAV
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        import wave

        wav_path = f.name
        with wave.open(f, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)  # 16-bit
            wf.setframerate(sample_rate)
            if isinstance(pcm_data, bytes):
                wf.writeframes(pcm_data)
            else:
                int16_data = (audio_array * 32768).clip(-32768, 32767).astype(np.int16)
                wf.writeframes(int16_data.tobytes())

    try:
        return transcribe_file(wav_path, model_size=model_size, language=language)
    finally:
        Path(wav_path).unlink(missing_ok=True)


def transcribe_segments(
    audio_path: str,
    segments: list[tuple[float, float]],
    model_size: str = "large-v3",
    language: str = "zh",
) -> list[dict]:
    """按时间段转写音频文件。

    Args:
        audio_path: 音频文件路径
        segments: [(start_sec, end_sec), ...] 时间段列表
        model_size: Whisper 模型大小
        language: 语言代码

    Returns:
        [{"start": 0.0, "end": 2.5, "text": "..."}, ...]
    """
    # 用 ffmpeg 提取各段音频
    results = []
    for start, end in segments:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            wav_path = f.name

        try:
            subprocess.run(
                [
                    "ffmpeg", "-y", "-i", audio_path,
                    "-ss", str(start), "-to", str(end),
                    "-acodec", "pcm_s16le", "-ac", "1", "-ar", "16000",
                    wav_path,
                ],
                capture_output=True,
                timeout=30,
                check=True,
            )
            result = transcribe_file(wav_path, model_size=model_size, language=language)
            results.append({
                "start": start,
                "end": end,
                "text": result["text"],
            })
        except Exception as e:
            logger.warning("段转写失败 [%.1f-%.1f]: %s", start, end, e)
            results.append({"start": start, "end": end, "text": ""})
        finally:
            Path(wav_path).unlink(missing_ok=True)

    return results
