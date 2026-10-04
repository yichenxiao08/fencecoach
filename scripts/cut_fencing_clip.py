"""Create a bounded review clip while retaining its parent source, timing and split group."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
from datetime import UTC, datetime
from pathlib import Path

import av
import imageio_ffmpeg


def cut(folder, output, start, end):
    parent = json.loads((folder / "source.json").read_text(encoding="utf-8"))
    if not 0 <= start < end <= parent["duration_ms"] / 1000 or end - start > 120:
        raise ValueError("Choose up to 120 seconds inside the original source.")
    clip_id = f"{parent['clip_id']}-{round(start * 1000)}-{round(end * 1000)}"
    if not re.fullmatch(r"[a-z0-9_-]{1,100}", clip_id):
        raise ValueError("Invalid source ID.")
    target = output / clip_id
    target.mkdir(parents=True, exist_ok=True)
    original = next(p for p in (folder / "source.mp4", folder / "source.video") if p.is_file())
    destination = target / "source.mp4"
    fingerprint = dict(
        parent_sha256=parent["sha256"],
        start_ms=round(start * 1000),
        end_ms=round(end * 1000),
        version="ffmpeg-cfr30-v1",
    )
    marker = target / "derivation.json"
    if (
        not destination.exists()
        or not marker.exists()
        or json.loads(marker.read_text()) != fingerprint
    ):
        temporary = target / "source.partial.mp4"
        command = [
            imageio_ffmpeg.get_ffmpeg_exe(),
            "-hide_banner",
            "-nostdin",
            "-y",
            "-loglevel",
            "error",
            "-i",
            str(original),
            "-ss",
            str(start),
            "-t",
            str(end - start),
            "-map",
            "0:v:0",
            "-an",
            "-vf",
            "fps=30",
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "20",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(temporary),
        ]
        with (target / "decode.log").open("w", encoding="utf-8") as log:
            subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=log, timeout=300)
        with av.open(str(temporary)) as media:
            stream = media.streams.video[0]
            actual_ms = round(float(stream.duration * stream.time_base) * 1000)
        if abs(actual_ms - (end - start) * 1000) > 150:
            raise ValueError("Derived clip duration differs from the requested source interval.")
        temporary.replace(destination)
        marker.write_text(json.dumps(fingerprint, indent=2), encoding="utf-8")
    with destination.open("rb") as data:
        digest = hashlib.file_digest(data, "sha256").hexdigest()
    record = dict(parent)
    record.update(
        clip_id=clip_id,
        filename="source.mp4",
        sha256=digest,
        bytes=destination.stat().st_size,
        duration_ms=round((end - start) * 1000),
        fps=30,
        derived=True,
        original_source_sha256=parent.get("original_source_sha256", parent["sha256"]),
        parent_collection=folder.parent.name,
        parent_clip_id=parent["clip_id"],
        source_start_ms=round(start * 1000),
        source_end_ms=round(end * 1000),
        transformation="Silent H.264 review excerpt, sampled at 30 fps. No new independent source.",
        created_at=datetime.now(UTC).isoformat(),
    )
    (target / "source.json").write_text(json.dumps(record, indent=2), encoding="utf-8")
    print(
        json.dumps(
            dict(
                clip_id=clip_id,
                duration_ms=record["duration_ms"],
                split_group=record["split_group"],
            )
        ),
        flush=True,
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path, default=Path("data/training/footwork-clips"))
    parser.add_argument("--start", type=float, required=True)
    parser.add_argument("--end", type=float, required=True)
    args = parser.parse_args()
    cut(args.source, args.output, args.start, args.end)


if __name__ == "__main__":
    main()
