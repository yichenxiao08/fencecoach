"""Produce collection and label-quality counts without fitting or promoting a model."""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path

from fencecoach.data_policy import eligible_source
from fencecoach.dataset_api import DatasetAnnotations
from fencecoach.footwork import VERSION, enrich_frames, movement_summary
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
    comparison = Counter()
    solo_comparison = Counter()
    original_records = []
    for file in sorted(args.data.glob("*/*/source.json")):
        source = json.loads(file.read_text(encoding="utf-8"))
        if not source.get("derived"):
            original_records.append(source)
            licenses.update([source["license"]])
        groups.add(source["split_group"])
        digests.add(source["sha256"])
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
            derived=bool(source.get("derived")),
            training_domain=source.get("training_domain", "unreviewed"),
            training_eligible=eligible_source(source),
            curation_note=source.get("curation_note"),
            labeled_intervals=len(labels.segments),
        )
        result_path = file.parent / "prepared/result.json"
        if result_path.exists():
            result = json.loads(result_path.read_text(encoding="utf-8"))
            profile = dict(facing=labels.facing, camera_motion=labels.camera_motion)
            enrich_frames(result["frames"], result["width"], result["height"], profile)
            summary = movement_summary(result["frames"])
            record.update(
                tracked_frames=result["tracked_frames"],
                sampled_frames=result["sampled_frames"],
                tracking_coverage=round(result["tracked_frames"] / result["sampled_frames"], 3),
                footwork_visible_frames=summary["visible_frames"],
                footwork_visible_fraction=summary["visible_fraction"],
            )
            if eligible_source(source) and result["frames"]:
                for start in range(0, result["frames"][-1]["time_ms"] - 749, 375):
                    outcomes = ["candidate_windows"]
                    if (
                        temporal_features(result["frames"], start, start + 750, "legacy-v1")
                        is not None
                    ):
                        outcomes.append("legacy_usable_windows")
                    if temporal_features(result["frames"], start, start + 750) is not None:
                        outcomes.append("footwork_usable_windows")
                    comparison.update(outcomes)
                    if source["clip_id"] in {
                        "step_forward",
                        "step_back",
                        "jumpe_lunge",
                        "jump_forward_jump_back",
                    }:
                        solo_comparison.update(outcomes)
            for label in labels.segments:
                if (
                    label.layer != "footwork"
                    or not eligible_source(source)
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
    if not all(reviewed[f"footwork:{label}"] for label in ("advance", "retreat", "bounce")):
        missing.append("Reviewed advance, retreat and bounce coverage remains incomplete.")
    if not ready:
        missing.append(
            "Baseline needs two classes, 20 usable reviewed windows per class and three independent groups per class."
        )
    missing.append("Commercial source rights and wider athlete/event coverage still need review.")
    report = dict(
        schema="fencecoach-data-audit-v2",
        downloaded_clips=len(original_records),
        derived_review_clips=sum(r["derived"] for r in records),
        eligible_modern_originals=sum(eligible_source(r) for r in original_records),
        eligible_modern_original_seconds=round(
            sum(r["duration_ms"] for r in original_records if eligible_source(r)) / 1000, 2
        ),
        eligible_modern_excerpts=sum(r["derived"] and r["training_eligible"] for r in records),
        excluded_sources=sum(not r["training_eligible"] for r in records),
        unique_source_hashes=len({r["sha256"] for r in original_records}),
        source_seconds=round(sum(r["duration_ms"] for r in original_records) / 1000, 2),
        source_bytes=sum(r["bytes"] for r in original_records),
        feature_version=VERSION,
        window_comparison_750ms=dict(comparison),
        original_four_solo_window_comparison_750ms=dict(solo_comparison),
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
