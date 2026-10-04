"""Collect the explicitly licensed MIT OCW starter corpus; never scrape arbitrary videos.

Sources, checksums, metadata and clip-level teaching topics are preserved separately from
movement annotations. A teaching topic is not a timestamped training label.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from urllib.request import Request, urlopen

PAGE = "https://ocw.mit.edu/courses/pe-740-fencing-spring-2007/pages/video/"
METADATA = "https://archive.org/metadata/MITPE.740S06"
LICENSE = "https://creativecommons.org/licenses/by-nc-sa/3.0/"
TOPICS = {
    "step_forward": "advance",
    "step_forward_group": "advance",
    "step_forward_group_2": "advance",
    "three_steps_forward_group": "advance",
    "tiny_steps_forward": "advance",
    "step_back": "retreat",
    "step_back_group": "retreat",
    "two_steps_back_group": "retreat",
    "tiny_steps_back_group": "retreat",
    "jump_forward_jump_back": "jump_forward_jump_back",
    "jump_forward_jump_back_group": "jump_forward_jump_back",
    "jump_forward_jump_back_group_2": "jump_forward_jump_back",
    "advance_lunge_group": "advance_lunge",
    "jumpe_lunge": "jump_lunge",
    "jump_lunge_group": "jump_lunge",
    "group_footwork_with_jarek_2": "mixed_footwork",
    "group_footwork_with_equipment": "mixed_footwork",
    "simple_thrusts_group": "thrust",
    "simple_thrust_with_advance": "advance_thrust",
    "lunge": "lunge_thrust",
    "advance_lunge": "advance_lunge_thrust",
    "jump_lunge": "jump_lunge_thrust",
    "parry_4_repost": "parry_riposte",
}


def fetch(url):
    return urlopen(Request(url, headers={"User-Agent": "FenceCoach-research/0.5"}), timeout=45)


def collect(entry, root):
    import av

    name = entry["name"]
    clip_id = name.removesuffix("-220k_512kb.mp4")
    folder = root / clip_id
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / "source.mp4"
    expected = entry["md5"]
    if not target.exists() or hashlib.md5(target.read_bytes()).hexdigest() != expected:
        temp = folder / "source.download"
        try:
            with (
                fetch(f"https://archive.org/download/MITPE.740S06/{name}") as response,
                temp.open("wb") as output,
            ):
                size = 0
                while chunk := response.read(1024 * 1024):
                    size += len(chunk)
                    if size > 50 * 1024 * 1024:
                        raise ValueError("Source exceeds the 50 MB collection bound.")
                    output.write(chunk)
            if hashlib.md5(temp.read_bytes()).hexdigest() != expected:
                raise ValueError(f"Archive checksum differs: {name}")
            temp.replace(target)
        finally:
            temp.unlink(missing_ok=True)
    with target.open("rb") as data:
        digest = hashlib.file_digest(data, "sha256").hexdigest()
    with av.open(str(target)) as container:
        stream = container.streams.video[0]
        container_duration_ms = round(container.duration / av.time_base * 1000)
        duration_ms = round(float(stream.duration * stream.time_base) * 1000)
        info = dict(
            width=stream.width,
            height=stream.height,
            fps=float(stream.average_rate),
            duration_ms=duration_ms,
            container_duration_ms=container_duration_ms,
        )
    record = dict(
        clip_id=clip_id,
        filename=name,
        source_url=f"https://archive.org/download/MITPE.740S06/{name}",
        source_page=PAGE,
        license="CC BY-NC-SA 3.0",
        license_url=LICENSE,
        attribution="MIT OpenCourseWare / PE.740 Fencing (Spring 2007) / Prof. Jaroslav Koniusz",
        archive_md5=expected,
        sha256=digest,
        bytes=target.stat().st_size,
        teaching_topic=TOPICS[clip_id],
        annotation_status="unlabeled",
        split_group="mit-pe740-course-cohort",
        athlete_id="unknown",
        commercial_use=False,
        collected_at=datetime.now(UTC).isoformat(),
        **info,
    )
    (folder / "source.json").write_text(json.dumps(record, indent=2), encoding="utf-8")
    print(f"Collected {clip_id}: {duration_ms / 1000:.2f}s", flush=True)
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("data/training/mit-ocw"))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    with fetch(METADATA) as response:
        metadata = json.load(response)
    if metadata["metadata"].get("licenseurl", "").replace("http:", "https:") != LICENSE:
        raise SystemExit("Archive license changed; inspect it before collection.")
    (args.output / "archive-metadata.json").write_text(
        json.dumps(metadata, indent=2), encoding="utf-8"
    )
    entries = [f for f in metadata["files"] if f["name"].removesuffix("-220k_512kb.mp4") in TOPICS]
    if len(entries) != len(TOPICS):
        raise SystemExit("Archive inventory differs from the documented 23 source clips.")
    with ThreadPoolExecutor(max_workers=3) as pool:
        records = list(pool.map(lambda entry: collect(entry, args.output), entries))
    manifest = dict(
        schema="fencecoach-source-manifest-v1",
        clips=records,
        notes=[
            "Noncommercial development corpus; not licensed for commercial use.",
            "All recordings are one course cohort; never split crops into independent sources.",
            "Teaching topics are weak clip-level metadata, not frame-level ground truth.",
        ],
    )
    (args.output / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(
        json.dumps(
            dict(
                clips=len(records),
                seconds=round(sum(r["duration_ms"] for r in records) / 1000, 2),
                bytes=sum(r["bytes"] for r in records),
            )
        )
    )


if __name__ == "__main__":
    main()
