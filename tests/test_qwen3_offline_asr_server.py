import pytest

np = pytest.importorskip("numpy")
sf = pytest.importorskip("soundfile")

from backend.qwen3_offline_asr_server import _decode_audio


def test_decode_raw_pcm():
    source = np.array([0, 16384, -16384], dtype=np.int16)
    audio, sample_rate = _decode_audio(source.tobytes(), 16000)
    assert sample_rate == 16000
    assert np.allclose(audio, [0, 0.5, -0.5])


def test_decode_wav():
    buffer = __import__("io").BytesIO()
    sf.write(buffer, np.zeros(1600, dtype=np.float32), 16000, format="WAV")
    audio, sample_rate = _decode_audio(buffer.getvalue(), 8000)
    assert sample_rate == 16000
    assert len(audio) == 1600
