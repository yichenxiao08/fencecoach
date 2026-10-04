"""Extract poses for selected athlete crops and export reviewed labels for the trainer.

Provisional labels are retained for review, but are never copied into training annotations.
This offline corpus does not create athlete sessions or training minutes in the app.
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

from fencecoach.dataset_api import DatasetAnnotations
from fencecoach.gestures import LABELS
from fencecoach.settings import settings
from fencecoach.video_pipeline import analyze


class OfflineJob:
    def __init__(self, folder, crop, profile):
        self.directory = folder
        self.payload = dict(source="training_corpus", crop=crop, capture_profile=profile)
        self.progress = -1

    def get(self, _):
        return self.payload

    def update(self, _, **fields):
        self.payload.update(fields)
        progress = fields.get("progress", self.progress)
        if progress // 20 > self.progress // 20:
            print(f"  {fields.get('stage', 'Extracting poses')}: {progress}%", flush=True)
        self.progress = progress


def prepare(folder, refresh=False):
    source = json.loads((folder / "source.json").read_text(encoding="utf-8"))
    labels_path = folder / "labels.json"
    marked = json.loads(labels_path.read_text(encoding="utf-8"))
    if marked.get("source_sha256", source["sha256"]) != source["sha256"]:
        raise ValueError("Label source checksum no longer matches the selected footage.")
    annotations = DatasetAnnotations.model_validate(marked)
    target = folder / "prepared"
    target.mkdir(exist_ok=True)
    source_path = folder / ("source.mp4" if source["filename"].endswith(".mp4") else "source.video")
    if not (target / "source.video").exists():
        shutil.copyfile(source_path, target / "source.video")
    fingerprint = dict(source_sha256=source["sha256"], crop=annotations.crop.model_dump())
    provenance_file = target / "preparation.json"
    previous = (
        json.loads(provenance_file.read_text(encoding="utf-8"))
        if provenance_file.exists()
        else None
    )
    if refresh or not (target / "result.json").exists() or previous != fingerprint:
        profile = dict(
            facing=annotations.facing, weapon=annotations.weapon, initial_guard_confirmed=False
        )
        analyze(
            OfflineJob(folder, fingerprint["crop"], profile),
            "prepared",
            settings.fencecoach_pose_model,
        )
        provenance_file.write_text(json.dumps(fingerprint, indent=2), encoding="utf-8")
    result_path = target / "result.json"
    result = json.loads(result_path.read_text(encoding="utf-8"))
    result.update(
        source_credit=source["attribution"],
        license=source["license"],
        source_sha256=source["sha256"],
        split_group=source["split_group"],
    )
    result_path.write_text(json.dumps(result), encoding="utf-8")
    reviewed = [
        s
        for s in annotations.segments
        if s.status == "reviewed" and s.layer == "footwork" and s.label in LABELS
    ]
    training = dict(
        reviewer=annotations.reviewer,
        review_status="human_reviewed" if reviewed else "provisional",
        reviewer_role=annotations.reviewer_role,
        license=source["license"],
        source_credit=source["attribution"],
        source_sha256=source["sha256"],
        split_group=source["split_group"],
        original_source_id=source["clip_id"],
        labels=[
            dict(start_ms=s.start_ms, end_ms=s.end_ms, label=s.label, note=s.note) for s in reviewed
        ],
        annotation_revision=annotations.revision,
    )
    (target / "annotations.json").write_text(json.dumps(training, indent=2), encoding="utf-8")
    (target / "draft-labels.json").write_text(json.dumps(marked, indent=2), encoding="utf-8")
    print(
        json.dumps(
            dict(
                clip=source["clip_id"],
                tracked=result["tracked_frames"],
                sampled=result["sampled_frames"],
                reviewed_training_intervals=len(reviewed),
                provisional_intervals=sum(s.status == "provisional" for s in annotations.segments),
            )
        ),
        flush=True,
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=Path("data/training/mit-ocw"))
    parser.add_argument("--clips", nargs="+", required=True)
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    for clip in args.clips:
        folder = (args.data / clip).resolve()
        if not folder.is_relative_to(args.data.resolve()):
            raise ValueError("Choose a clip inside the dataset.")
        print(f"Preparing {clip}", flush=True)
        prepare(folder, args.refresh)


if __name__ == "__main__":
    main()
