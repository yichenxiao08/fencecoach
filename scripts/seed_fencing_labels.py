"""Install versioned assistant draft labels; preserve every existing human edit."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from fencecoach.dataset_api import DatasetAnnotations


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=Path("data/training"))
    parser.add_argument("--labels", type=Path, default=Path("datasets/starter-annotations.json"))
    args = parser.parse_args()
    bundle = json.loads(args.labels.read_text(encoding="utf-8"))
    installed = 0
    for seed in bundle["clips"]:
        folder = args.data / seed["collection"] / seed["clip_id"]
        source = json.loads((folder / "source.json").read_text(encoding="utf-8"))
        if source["sha256"] != seed["source_sha256"]:
            raise ValueError(f"Source changed: {seed['clip_id']}")
        destination = folder / "labels.json"
        if destination.exists():
            continue
        payload = DatasetAnnotations.model_validate(seed["annotations"]).model_dump()
        payload.update(source_sha256=source["sha256"], seed_version=bundle["version"])
        destination.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        installed += len(payload["segments"])
    print(
        json.dumps(
            dict(
                installed_draft_segments=installed,
                note="No human-reviewed ground truth was created.",
            )
        )
    )


if __name__ == "__main__":
    main()
