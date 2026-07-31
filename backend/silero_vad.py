"""Silero VAD — 神经网络语音活动检测，替代 Energy Gate。

使用 ONNX Runtime 推理，无需 GPU，CPU 即可运行。
模型: silero_vad.onnx (2.3MB)
输入: 16kHz 单声道 PCM float32
输出: 语音概率 0~1
"""
import logging
import numpy as np
import onnxruntime as ort
from pathlib import Path

logger = logging.getLogger(__name__)

_MODEL_PATH = Path(__file__).parent.parent / "data" / "models" / "silero_vad.onnx"
_session: ort.InferenceSession | None = None


def _get_session() -> ort.InferenceSession:
    global _session
    if _session is None:
        if not _MODEL_PATH.exists():
            raise FileNotFoundError(f"Silero VAD 模型不存在: {_MODEL_PATH}")
        _session = ort.InferenceSession(
            str(_MODEL_PATH), providers=["CPUExecutionProvider"]
        )
        logger.info("Silero VAD 模型加载: %s", _MODEL_PATH)
    return _session


class SileroVAD:
    """流式 Silero VAD，替代 Energy Gate。

    用法:
        vad = SileroVad(threshold=0.5)
        for pcm_bytes in audio_chunks:
            is_speech = vad.process(pcm_bytes)  # int16 PCM, 16kHz
            if is_speech:
                send_to_asr(pcm_bytes)
    """

    def __init__(self, threshold: float = 0.5, sample_rate: int = 16000):
        self.threshold = threshold
        self.sample_rate = sample_rate
        self._state = np.zeros((2, 1, 128), dtype=np.float32)
        self._session = _get_session()
        # 自适应阈值
        self._adaptive_threshold = threshold
        self._speech_count = 0
        self._silence_count = 0

    def reset(self):
        """重置状态（新 session 时调用）"""
        self._state = np.zeros((2, 1, 128), dtype=np.float32)
        self._adaptive_threshold = self.threshold
        self._speech_count = 0
        self._silence_count = 0

    def process(self, pcm_bytes: bytes) -> tuple[bool, float]:
        """处理一帧 PCM 音频，返回 (是否语音, 语音概率)。

        Args:
            pcm_bytes: int16 PCM 音频数据，16kHz 单声道

        Returns:
            (is_speech, probability)
        """
        # int16 → float32
        samples = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        if len(samples) == 0:
            return False, 0.0

        # Silero VAD 需要 512 samples (32ms@16kHz) 的倍数
        # 对于更长的 chunk，取最后 512 samples 做检测
        if len(samples) > 512:
            samples = samples[-512:]

        audio = samples.reshape(1, -1)
        sr = np.array(self.sample_rate, dtype=np.int64)

        try:
            outputs = self._session.run(
                None, {"input": audio, "state": self._state, "sr": sr}
            )
            prob = float(outputs[0][0][0])
            self._state = outputs[1]  # 更新状态

            is_speech = prob >= self._adaptive_threshold

            # 自适应阈值调节
            if is_speech:
                self._speech_count += 1
                self._silence_count = 0
            else:
                self._silence_count += 1
                self._speech_count = 0

            # 如果连续检测到语音，稍微降低阈值（更容易通过）
            if self._speech_count > 5:
                self._adaptive_threshold = max(0.3, self._adaptive_threshold - 0.02)
            # 如果连续静音，恢复阈值
            elif self._silence_count > 10:
                self._adaptive_threshold = min(self.threshold, self._adaptive_threshold + 0.02)

            return is_speech, prob

        except Exception as e:
            logger.warning("Silero VAD 推理异常: %s", e)
            return False, 0.0


class SileroVADBatch:
    """批量 Silero VAD，用于录音文件的事后分析。

    用法:
        vad = SileroVadBatch()
        segments = vad.detect_speech(pcm_data_16k, sample_rate=16000)
        # segments = [(start_sample, end_sample), ...]
    """

    def __init__(self, threshold: float = 0.5, min_speech_ms: int = 250, min_silence_ms: int = 400):
        self.threshold = threshold
        self.min_speech_samples = int(min_speech_ms * 16)  # 16 samples/ms @ 16kHz
        self.min_silence_samples = int(min_silence_ms * 16)

    def detect_speech(self, audio_data: np.ndarray, sample_rate: int = 16000) -> list[tuple[int, int]]:
        """检测音频中的语音段。

        Args:
            audio_data: float32 音频数据，16kHz
            sample_rate: 采样率

        Returns:
            [(start_sample, end_sample), ...] 语音段列表
        """
        session = _get_session()
        state = np.zeros((2, 1, 128), dtype=np.float32)
        sr = np.array(sample_rate, dtype=np.int64)

        # 每 512 samples 检测一次
        chunk_size = 512
        probs = []
        for i in range(0, len(audio_data), chunk_size):
            chunk = audio_data[i : i + chunk_size]
            if len(chunk) < chunk_size:
                chunk = np.pad(chunk, (0, chunk_size - len(chunk)))
            audio = chunk.reshape(1, -1).astype(np.float32)
            outputs = session.run(None, {"input": audio, "state": state, "sr": sr})
            probs.append(float(outputs[0][0][0]))
            state = outputs[1]

        # 合并连续语音段
        segments = []
        in_speech = False
        speech_start = 0
        silence_start = 0

        for i, prob in enumerate(probs):
            sample_pos = i * chunk_size
            if prob >= self.threshold:
                if not in_speech:
                    speech_start = sample_pos
                    in_speech = True
                silence_start = sample_pos
            else:
                if in_speech:
                    silence_duration = sample_pos - silence_start
                    if silence_duration >= self.min_silence_samples:
                        speech_duration = silence_start - speech_start
                        if speech_duration >= self.min_speech_samples:
                            segments.append((speech_start, silence_start + chunk_size))
                        in_speech = False

        # 最后一段
        if in_speech:
            speech_duration = len(audio_data) - speech_start
            if speech_duration >= self.min_speech_samples:
                segments.append((speech_start, len(audio_data)))

        return segments
