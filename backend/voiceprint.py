"""
backend/voiceprint.py — 声纹识别引擎

完全基于 pyannote 的 speaker embedding 提取、匹配与 diarization。
提供：
- VoiceprintEngine: 单例引擎，管理模型加载与推理
- embedding 提取、cosine 相似度匹配
- 会后 speaker diarization（pyannote/speaker-diarization-3.1）

依赖: pyannote-audio, numpy, soundfile
被依赖: backend_full.py, backend/routes/voiceprint.py
"""

import io
import logging
import os
import threading
import numpy as np
from typing import Optional, Tuple, List, Dict

logger = logging.getLogger(__name__)

# ═══ 全局单例 ═══════════════════════════════════════════════════════════════════

_engine_instance: Optional["VoiceprintEngine"] = None
_engine_lock = threading.Lock()


def get_voiceprint_engine() -> Optional["VoiceprintEngine"]:
    """获取全局 VoiceprintEngine 单例，未初始化时返回 None。"""
    return _engine_instance


def init_voiceprint_engine() -> "VoiceprintEngine":
    """初始化全局 VoiceprintEngine 单例。"""
    global _engine_instance
    with _engine_lock:
        if _engine_instance is not None:
            logger.warning("VoiceprintEngine already initialized, returning existing instance")
            return _engine_instance
        _engine_instance = VoiceprintEngine()
        return _engine_instance


# ═══ 核心引擎 ═══════════════════════════════════════════════════════════════════

class VoiceprintEngine:
    """声纹识别引擎 — pyannote speaker embedding + diarization。

    使用方式:
        engine = VoiceprintEngine()
        embedding = engine.extract_embedding(audio_array, sample_rate=16000)
        user_id, confidence = engine.identify_speaker(audio_array, enrolled_profiles)
        segments = engine.diarize(wav_path)
    """

    # embedding 维度（pyannote wespeaker 输出 256-dim）
    EMBEDDING_DIM = 256

    # 相似度阈值：高于此值判定为同一人
    DEFAULT_THRESHOLD = 0.50

    # 最小音频时长（秒）：低于此值不提取 embedding
    MIN_AUDIO_DURATION = 1.0

    # 会后校准匹配阈值
    DIAR_MATCH_THRESHOLD = 0.50

    # 用于匹配的最短片段时长（秒）
    MIN_SEGMENT_DURATION = 2.0

    # pyannote 模型标识
    _DIAR_MODEL_ID = "pyannote/speaker-diarization-3.1"
    _EMBED_MODEL_ID = "pyannote/wespeaker-voxceleb-resnet34-LM"

    def __init__(self):
        """初始化引擎，懒加载模型。"""
        self._lock = threading.Lock()
        self._embed_model = None      # pyannote embedding model
        self._embed_inference = None  # pyannote Inference
        self._diar_pipeline = None    # pyannote diarization pipeline
        self._diar_device = None
        self._hf_token = os.getenv("HF_TOKEN")

        if not self._hf_token:
            logger.warning("HF_TOKEN not set, pyannote models may fail to load")

    @property
    def is_ready(self) -> bool:
        """引擎是否已就绪（embedding 模型已加载）。"""
        self._ensure_embed_model()
        return self._embed_inference is not None

    def _ensure_embed_model(self):
        """懒加载 pyannote speaker embedding 模型。"""
        if self._embed_inference is not None:
            return
        with self._lock:
            if self._embed_inference is not None:
                return
            try:
                import torch
                from pyannote.audio import Model as PyannoteModel, Inference

                logger.info("Loading pyannote embedding model: %s", self._EMBED_MODEL_ID)
                model = PyannoteModel.from_pretrained(self._EMBED_MODEL_ID, token=self._hf_token)
                self._embed_model = model
                self._embed_inference = Inference(model, window='whole')
                logger.info("pyannote embedding model loaded (dim=%d)", model.dimension)
            except Exception as e:
                logger.error("Failed to load pyannote embedding model: %s", e)

    def _ensure_diar_pipeline(self, device: str = "cuda:0"):
        """懒加载 pyannote speaker-diarization pipeline。"""
        if self._diar_pipeline is not None:
            return
        with self._lock:
            if self._diar_pipeline is not None:
                return
            try:
                import torch
                from pyannote.audio import Pipeline as PyannotePipeline

                devices_to_try = [device, "cpu"] if device != "cpu" else ["cpu"]
                last_err = None
                for dev in devices_to_try:
                    try:
                        logger.info("Loading pyannote diarization pipeline on %s...", dev)
                        pipeline = PyannotePipeline.from_pretrained(
                            self._DIAR_MODEL_ID, token=self._hf_token,
                        )
                        pipeline.to(torch.device(dev))
                        self._diar_pipeline = pipeline
                        self._diar_device = dev
                        logger.info("pyannote diarization pipeline loaded on %s", dev)
                        return
                    except Exception as e:
                        last_err = e
                        logger.warning("Failed to load diarization on %s: %s", dev, e)
                raise RuntimeError(f"无法加载 diarization 模型: {last_err}")
            except Exception as e:
                logger.error("Failed to load diarization pipeline: %s", e)

    # ── embedding 提取 ─────────────────────────────────────────────────────────

    def extract_embedding(self, audio: np.ndarray, sample_rate: int = 16000) -> Optional[np.ndarray]:
        """从音频提取 speaker embedding（pyannote wespeaker）。

        Args:
            audio: 音频数据，float32 或 int16 numpy 数组
            sample_rate: 采样率，默认 16000

        Returns:
            256-dim float32 numpy 数组（L2 归一化），失败返回 None
        """
        self._ensure_embed_model()
        if self._embed_inference is None:
            logger.error("Embedding model not ready")
            return None

        # 转换为 float32
        if audio.dtype == np.int16:
            audio = audio.astype(np.float32) / 32768.0
        elif audio.dtype != np.float32:
            audio = audio.astype(np.float32)

        # 检查时长
        duration = len(audio) / sample_rate
        if duration < self.MIN_AUDIO_DURATION:
            logger.warning("Audio too short for embedding: %.2fs (min %.1fs)", duration, self.MIN_AUDIO_DURATION)
            return None

        try:
            import torch

            # 重采样到 16kHz
            if sample_rate != 16000:
                import torchaudio
                resampler = torchaudio.transforms.Resample(sample_rate, 16000)
                audio = resampler(torch.from_numpy(audio).unsqueeze(0)).squeeze(0).numpy()

            waveform = torch.from_numpy(audio).unsqueeze(0)  # (1, samples)
            embedding = self._embed_inference({"waveform": waveform, "sample_rate": 16000})

            # L2 归一化
            emb = embedding.astype(np.float32)
            norm = np.linalg.norm(emb)
            if norm > 0:
                emb = emb / norm
            return emb

        except Exception as e:
            logger.error("Failed to extract embedding: %s", e)
            return None

    def extract_embedding_from_bytes(self, audio_bytes: bytes, sample_rate: int = 16000) -> Optional[np.ndarray]:
        """从音频字节流提取 embedding（支持 PCM16 和 WAV）。"""
        try:
            if audio_bytes[:4] == b'RIFF':
                import wave
                with wave.open(io.BytesIO(audio_bytes), 'rb') as wf:
                    sample_rate = wf.getframerate()
                    frames = wf.readframes(wf.getnframes())
                    audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
            else:
                audio = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0
            return self.extract_embedding(audio, sample_rate)
        except Exception as e:
            logger.error("Failed to extract embedding from bytes: %s", e)
            return None

    def extract_embedding_from_file(self, audio_path: str) -> Optional[np.ndarray]:
        """从音频文件提取 embedding（支持任意 soundfile 格式）。"""
        try:
            import soundfile as sf
            audio, sr = sf.read(audio_path, dtype="float32")
            if audio.ndim > 1:
                audio = audio.mean(axis=1)
            return self.extract_embedding(audio, sample_rate=sr)
        except Exception as e:
            logger.error("Failed to extract embedding from file: %s", e)
            return None

    # ── 相似度与匹配 ───────────────────────────────────────────────────────────

    def cosine_similarity(self, emb1: np.ndarray, emb2: np.ndarray) -> float:
        """计算两个 embedding 的 cosine 相似度。"""
        dot = np.dot(emb1, emb2)
        norm1 = np.linalg.norm(emb1)
        norm2 = np.linalg.norm(emb2)
        if norm1 == 0 or norm2 == 0:
            return 0.0
        return float(dot / (norm1 * norm2))

    def identify_speaker(
        self,
        audio: np.ndarray,
        enrolled: Dict[str, np.ndarray],
        sample_rate: int = 16000,
        threshold: float = None,
    ) -> Tuple[Optional[str], float]:
        """识别音频中的说话人。"""
        if threshold is None:
            threshold = self.DEFAULT_THRESHOLD
        if not enrolled:
            return None, 0.0
        embedding = self.extract_embedding(audio, sample_rate)
        if embedding is None:
            return None, 0.0
        return self._match_embedding(embedding, enrolled, threshold)

    def identify_speaker_from_bytes(
        self,
        audio_bytes: bytes,
        enrolled: Dict[str, np.ndarray],
        sample_rate: int = 16000,
        threshold: float = None,
    ) -> Tuple[Optional[str], float]:
        """从音频字节流识别说话人。"""
        embedding = self.extract_embedding_from_bytes(audio_bytes, sample_rate)
        if embedding is None:
            return None, 0.0
        if threshold is None:
            threshold = self.DEFAULT_THRESHOLD
        return self._match_embedding(embedding, enrolled, threshold)

    def _match_embedding(
        self,
        embedding: np.ndarray,
        enrolled: Dict[str, np.ndarray],
        threshold: float,
    ) -> Tuple[Optional[str], float]:
        """将 embedding 与已注册声纹匹配，返回最佳匹配。"""
        best_user = None
        best_score = -1.0
        for user_id, enrolled_emb in enrolled.items():
            score = self.cosine_similarity(embedding, enrolled_emb)
            if score > best_score:
                best_score = score
                best_user = user_id
        if best_score >= threshold:
            return best_user, best_score
        return None, best_score

    # ── speaker diarization ────────────────────────────────────────────────────

    def diarize(self, wav_path: str, device: str = "cuda:0") -> List[Dict]:
        """对音频执行 speaker diarization（说话人分离）。

        Args:
            wav_path: 音频文件路径
            device: torch device，默认 "cuda:0"

        Returns:
            [{"start": float, "end": float, "speaker": "SPEAKER_00"}, ...]
        """
        self._ensure_diar_pipeline(device)
        if self._diar_pipeline is None:
            logger.error("Diarization pipeline not ready")
            return []

        try:
            import torch
            import soundfile as sf

            audio_np, sr = sf.read(wav_path, dtype="float32")
            if audio_np.ndim > 1:
                audio_np = audio_np.mean(axis=1)
            if sr != 16000:
                import torchaudio
                resampler = torchaudio.transforms.Resample(sr, 16000)
                audio_np = resampler(torch.from_numpy(audio_np).unsqueeze(0)).squeeze(0).numpy()
                sr = 16000

            waveform = torch.from_numpy(audio_np).unsqueeze(0)
            result = self._diar_pipeline({"waveform": waveform, "sample_rate": sr})

            # pyannote 4.0.7: DiarizeOutput → .speaker_diarization
            annotation = result.speaker_diarization if hasattr(result, 'speaker_diarization') else result

            segments = []
            for turn, _, speaker in annotation.itertracks(yield_label=True):
                segments.append({
                    "start": round(turn.start, 3),
                    "end": round(turn.end, 3),
                    "speaker": speaker,
                })

            logger.info(
                "pyannote diarization: %d segments, %d speakers, device=%s",
                len(segments),
                len(set(s["speaker"] for s in segments)),
                self._diar_device,
            )
            return segments

        except Exception as e:
            logger.error("Diarization failed: %s", e)
            return []

    def match_diarization_to_enrolled(
        self,
        diar_segments: List[Dict],
        wav_path: str,
        enrolled: Dict[str, np.ndarray],
        min_segment_sec: float = None,
    ) -> Dict[str, str]:
        """将 diarization 的说话人标签映射到已注册的用户 ID。

        对每个 speaker，收集所有合格片段的 pyannote embedding，
        加权平均后与已注册声纹做 cosine similarity 匹配。

        Args:
            diar_segments: diarize() 返回的 segments 列表
            wav_path: 原始音频文件路径
            enrolled: {user_id: 256-dim embedding}
            min_segment_sec: 最短匹配片段时长

        Returns:
            {"SPEAKER_00": "user_id_1", ...}
        """
        if min_segment_sec is None:
            min_segment_sec = self.MIN_SEGMENT_DURATION
        if not diar_segments or not enrolled:
            return {}

        try:
            import soundfile as sf

            waveform_np, sr = sf.read(wav_path, dtype="float32")
            if waveform_np.ndim > 1:
                waveform_np = waveform_np.mean(axis=1)

            # 重采样到 16kHz
            if sr != 16000:
                import torch
                import torchaudio
                resampler = torchaudio.transforms.Resample(sr, 16000)
                waveform_np = resampler(torch.from_numpy(waveform_np).unsqueeze(0)).squeeze(0).numpy()
                sr = 16000

            # 按 speaker 分组
            speaker_segments: Dict[str, List[Dict]] = {}
            for seg in diar_segments:
                speaker_segments.setdefault(seg["speaker"], []).append(seg)

            label_map: Dict[str, str] = {}

            for speaker, segs in speaker_segments.items():
                # 收集该 speaker 所有合格片段的 embedding
                embeddings = []
                for seg in segs:
                    dur = seg["end"] - seg["start"]
                    if dur < min_segment_sec:
                        continue
                    start_sample = int(seg["start"] * sr)
                    end_sample = int(seg["end"] * sr)
                    chunk = waveform_np[start_sample:end_sample]
                    if len(chunk) < sr * self.MIN_AUDIO_DURATION:
                        continue
                    emb = self.extract_embedding(chunk, sample_rate=sr)
                    if emb is not None:
                        embeddings.append(emb)

                if not embeddings:
                    # 所有片段太短，合并全部
                    total_dur = sum(s["end"] - s["start"] for s in segs)
                    if total_dur < min_segment_sec:
                        continue
                    start_sample = int(segs[0]["start"] * sr)
                    end_sample = int(segs[-1]["end"] * sr)
                    chunk = waveform_np[start_sample:end_sample]
                    emb = self.extract_embedding(chunk, sample_rate=sr)
                    if emb is not None:
                        embeddings.append(emb)

                if not embeddings:
                    continue

                # 加权平均
                embedding = merge_embeddings(embeddings)

                # 匹配
                best_user, best_score = self._match_embedding(embedding, enrolled, self.DIAR_MATCH_THRESHOLD)
                if best_user:
                    label_map[speaker] = best_user
                    logger.info(
                        "Speaker %s → user %s (score=%.3f, %d segments)",
                        speaker, best_user, best_score, len(embeddings),
                    )
                else:
                    logger.debug("Speaker %s: no match (best=%.3f)", speaker, best_score)

            return label_map

        except Exception as e:
            logger.error("match_diarization_to_enrolled failed: %s", e)
            return {}


# ═══ 工具函数 ═══════════════════════════════════════════════════════════════════

def merge_embeddings(embeddings: List[np.ndarray], weights: List[float] = None) -> np.ndarray:
    """合并多个 embedding 为一个（加权平均后归一化）。"""
    if not embeddings:
        raise ValueError("Empty embeddings list")
    if weights is None:
        weights = [1.0] * len(embeddings)
    if len(weights) != len(embeddings):
        raise ValueError("Weights length mismatch")
    total_weight = sum(weights)
    merged = np.zeros_like(embeddings[0])
    for emb, w in zip(embeddings, weights):
        merged += emb * w
    merged /= total_weight
    norm = np.linalg.norm(merged)
    if norm > 0:
        merged = merged / norm
    return merged.astype(np.float32)


def serialize_embedding(embedding: np.ndarray) -> bytes:
    """将 embedding 序列化为 bytes（用于数据库存储）。"""
    return embedding.astype(np.float32).tobytes()


def deserialize_embedding(data: bytes) -> np.ndarray:
    """从 bytes 反序列化 embedding。"""
    return np.frombuffer(data, dtype=np.float32).copy()
