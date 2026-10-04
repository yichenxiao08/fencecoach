"""Produce collection and label-quality counts without fitting or promoting a model."""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path

from fencecoach.dataset_api import DatasetAnnotations
from fencecoach.gestures import LABELS, temporal_features


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=Path("data/training"))
    parser.add_argument("--output", type=Path, default=Path("data/training/audit.json"))
    args = parser.parse_args()
    counts, licenses, classes, reviewed, groups, digests = (
        Counter(),
        Counter(),
        Counter(),
        Counter(),
        set(),
        set(),
    )
    records, previews, approved = [], Counter(), Counter()
    approved_groups = defaultdict(set)
    for file in sorted(args.data.glob("*/*/source.json")):
        source = json.loads(file.read_text(encoding="utf-8"))
        groups.add(source["split_group"])
        digests.add(source["sha256"])
        licenses.update([source["license"]])
        marked = file.parent / "labels.json"
        labels = (
            DatasetAnnotations.model_validate_json(marked.read_text(encoding="utf-8"))
            if marked.exists()
            else DatasetAnnotations()
        )
        for label in labels.segments:
            counts.update([label.status])
            classes.update([f"{label.layer}:{label.label}"])
            if label.status == "reviewed":
                reviewed.update([f"{label.layer}:{label.label}"])
        record = dict(
            collection=file.parent.parent.name,
            clip_id=source["clip_id"],
            duration_ms=source["duration_ms"],
            bytes=source["bytes"],
            license=source["license"],
            source_sha256=source["sha256"],
            split_group=source["split_group"],
            labeled_intervals=len(labels.segments),
        )
        result_path = file.parent / "prepared/result.json"
        if result_path.exists():
            result = json.loads(result_path.read_text(encoding="utf-8"))
            record.update(
                tracked_frames=result["tracked_frames"],
                sampled_frames=result["sampled_frames"],
                tracking_coverage=round(result["tracked_frames"] / result["sampled_frames"], 3),
            )
            for label in labels.segments:
                if (
                    label.layer != "footwork"
                    or label.label not in LABELS
                    or label.status == "rejected"
                ):
                    continue
                for start in range(label.start_ms, label.end_ms - 749, 375):
                    if temporal_features(result["frames"], start, start + 750) is not None:
                        previews.update([label.label])
                        if label.status == "reviewed":
                            approved.update([label.label])
                            approved_groups[label.label].add(source["split_group"])
        records.append(record)
    ready = len(approved) >= 2 and all(
        count >= 20 and len(approved_groups[label]) >= 3 for label, count in approved.items()
    )
    missing = []
    if not reviewed:
        missing.append("No human-reviewed intervals yet.")
    if not all(reviewed[label] for label in ("footwork:fleche", "tactics:counterattack")):
        missing.append("Verified fleche and counterattack coverage remains incomplete.")
    if not ready:
        missing.append(
            "Baseline needs two classes, 20 usable reviewed windows per class and three independent groups per class."
        )
    missing.append("Commercial source rights and wider athlete/event coverage still need review.")
    report = dict(
        schema="fencecoach-data-audit-v1",
        downloaded_clips=len(records),
        unique_source_hashes=len(digests),
        source_seconds=round(sum(r["duration_ms"] for r in records) / 1000, 2),
        source_bytes=sum(r["bytes"] for r in records),
        independent_cohort_groups=sorted(groups),
        licensed_sources=dict(licenses),
        interval_status=dict(counts),
        interval_classes=dict(classes),
        reviewed_classes=dict(reviewed),
        prepared_clips=sum("tracked_frames" in r for r in records),
        draft_visible_windows_750ms=dict(previews),
        reviewed_visible_windows_750ms=dict(approved),
        reviewed_groups_per_class={
            label: sorted(values) for label, values in approved_groups.items()
        },
        training_ready=ready,
        missing=missing,
        clips=records,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k not in {"clips", "missing"}}, indent=2))


if __name__ == "__main__":
    main()
