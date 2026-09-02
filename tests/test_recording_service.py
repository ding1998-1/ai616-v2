from pathlib import Path

from backend.services import recording_service


def test_chunk_storage_is_idempotent_and_keeps_bytes(tmp_path: Path):
    name = recording_service.chunk_name("phone-a", "alice", 3, ".webm")
    assert name == "chunk_phone-a_000003.webm"

    path, duplicate = recording_service.store_chunk(tmp_path, name, b"first")
    assert path.read_bytes() == b"first"
    assert duplicate is False

    same_path, duplicate = recording_service.store_chunk(tmp_path, name, b"second")
    assert same_path == path
    assert duplicate is True
    assert path.read_bytes() == b"first"


def test_audio_client_cannot_be_reused_by_another_user(monkeypatch):
    monkeypatch.setattr(
        recording_service,
        "_db_get_audio_client",
        lambda meeting_id, client_id: {
            "meeting_id": meeting_id,
            "client_id": client_id,
            "user_id": "user-alice",
            "username": "alice",
        },
    )
    assert recording_service.audio_client_owned_by("m1", "phone-a", {"id": "user-alice"})
    assert not recording_service.audio_client_owned_by("m1", "phone-a", {"id": "user-bob"})
    assert recording_service.audio_client_owned_by("m1", "phone-a", {"role": "admin", "id": "root"})


def test_unknown_audio_client_can_be_claimed_once(monkeypatch):
    monkeypatch.setattr(recording_service, "_db_get_audio_client", lambda *_: None)
    assert recording_service.audio_client_owned_by("m1", "new-device", {"id": "user-bob"})
    assert recording_service.audio_client_owned_by("m1", "", {"id": "user-bob"})


def test_recording_manifest_groups_ten_chunks_into_checkpoint(tmp_path: Path):
    for index in range(11):
        path = tmp_path / f"chunk_phone_session_{index:06d}.webm"
        path.write_bytes(b"audio")
        manifest = recording_service.record_chunk_receipt(
            tmp_path, "session", index, path, "phone", "user", index * 3000, 3000,
        )

    assert manifest["receivedChunks"] == list(range(11))
    assert len(manifest["checkpoints"]) == 2
    assert manifest["checkpoints"][0]["startChunk"] == 0
    assert manifest["checkpoints"][0]["endChunk"] == 9
    assert manifest["checkpoints"][0]["endMs"] == 30000


def test_continuous_media_recorder_chunks_are_joined_byte_for_byte(tmp_path: Path):
    chunks = []
    for index, content in enumerate((b"webm-header", b"cluster-one", b"cluster-two")):
        path = tmp_path / f"chunk_phone_session_{index:06d}.webm"
        path.write_bytes(content)
        chunks.append(path)

    output = tmp_path / "joined.webm"
    recording_service._join_continuous_chunks(chunks, output)

    assert output.read_bytes() == b"webm-headercluster-onecluster-two"


def test_safari_mp4_mime_keeps_mp4_extension():
    assert recording_service.extension_for_mime("audio/mp4", "chunk_0.webm") == ".mp4"
    assert recording_service.extension_for_mime("audio/webm;codecs=opus", "chunk_0.mp4") == ".webm"
    assert recording_service.extension_for_mime("audio/ogg;codecs=opus", "chunk_0.webm") == ".ogg"
