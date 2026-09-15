"""Standalone pyannote worker intended to run in an isolated Python environment."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--device", default="cuda:0")
    parser.add_argument("--model", required=True)
    args = parser.parse_args()

    source = Path(args.input).resolve()
    output = Path(args.output).resolve()
    if not source.is_file():
        raise FileNotFoundError(source)

    os.environ["SPEAKER_DIARIZATION_MODEL"] = args.model
    from backend.voiceprint import init_voiceprint_engine

    segments = init_voiceprint_engine().diarize(str(source), args.device)
    if not segments:
        raise RuntimeError("speaker diarization returned no segments")
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(".tmp")
    temporary.write_text(json.dumps({"segments": segments}, ensure_ascii=False), encoding="utf-8")
    temporary.replace(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
