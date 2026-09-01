import io
import wave

from backend.services.offline_asr_client import pcm16_to_wav


def test_pcm16_to_wav_preserves_audio_shape():
    pcm = b"\x00\x00" * 1600
    wav_bytes = pcm16_to_wav(pcm, 16000)
    with wave.open(io.BytesIO(wav_bytes), "rb") as wav_file:
        assert wav_file.getnchannels() == 1
        assert wav_file.getsampwidth() == 2
        assert wav_file.getframerate() == 16000
        assert wav_file.getnframes() == 1600
