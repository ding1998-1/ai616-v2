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
