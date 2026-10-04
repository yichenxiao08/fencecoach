"""Download pinned local pose weights and, optionally, an attributed public example."""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
from urllib.request import urlopen

from fencecoach.settings import settings
from fencecoach.video_jobs import DEMO_SHA, DEMO_URL, MODEL_SHA

MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task"


def download(url: str, target: Path, expected_hash: str | None = None):
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.is_file() and (
        not expected_hash or hashlib.sha256(target.read_bytes()).hexdigest() == expected_hash
    ):
        print(f"Ready: {target}")
        return
    temporary = target.with_suffix(".download")
    try:
        with urlopen(url, timeout=45) as response, temporary.open("wb") as output:
            size = 0
            while chunk := response.read(1024 * 1024):
                size += len(chunk)
                if size > 50 * 1024 * 1024:
                    raise ValueError("Download exceeded the expected 50 MB bound.")
                output.write(chunk)
        if expected_hash and hashlib.sha256(temporary.read_bytes()).hexdigest() != expected_hash:
            raise ValueError("Downloaded model checksum differs from the pinned version.")
        temporary.replace(target)
        print(f"Downloaded: {target}")
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--demo", action="store_true", help="Also fetch the noncommercial MIT OCW example."
    )
    args = parser.parse_args()
    download(MODEL_URL, settings.fencecoach_pose_model, MODEL_SHA)
    if args.demo:
        download(
            DEMO_URL,
            settings.fencecoach_video_dir.parent / "video-demo" / "mit-jump-lunge.mp4",
            DEMO_SHA,
        )
        print("MIT OpenCourseWare / PE.740 Fencing / Spring 2007 / Prof. Jaroslav Koniusz")
        print("License: https://creativecommons.org/licenses/by-nc-sa/3.0/")
