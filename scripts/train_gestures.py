"""Train on human labels, split by original video hash, export safe JSON weights.

Usage: python scripts/train_gestures.py --data data/videos --output models/gestures.json
Promotion is explicit: --promote, after enough independent clips and held-out macro F1 >= .75.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, f1_score
from sklearn.model_selection import GroupShuffleSplit
from sklearn.preprocessing import StandardScaler

from fencecoach.gestures import FEATURES, Annotations, temporal_features


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=Path("data/videos"))
    parser.add_argument("--output", type=Path, default=Path("models/gestures.json"))
    parser.add_argument("--promote", action="store_true")
    parser.add_argument("--window-ms", type=int, choices=(500, 750, 1000, 1500), default=750)
    args = parser.parse_args()
    examples, labels, groups, sources = [], [], [], []
    parents, hash_groups = {}, {}

    def root(value):
        parents.setdefault(value, value)
        if parents[value] != value:
            parents[value] = root(parents[value])
        return parents[value]

    skipped_provisional = 0
    for annotation in args.data.rglob("annotations.json"):
        directory = annotation.parent
        if not (directory / "result.json").is_file() or not (directory / "source.video").is_file():
            continue
        marked = json.loads(annotation.read_text(encoding="utf-8"))
        if (
            marked.get("review_status") == "provisional"
            or marked.get("reviewer_role") == "assistant"
        ):
            skipped_provisional += 1
            continue
        Annotations.model_validate(marked)
        result = json.loads((directory / "result.json").read_text(encoding="utf-8"))
        # Identical uploads must stay in the same split. Hash source bytes, not generated job ID.
        with (directory / "source.video").open("rb") as source_file:
            digest = hashlib.file_digest(source_file, "sha256").hexdigest()
        if marked.get("source_sha256", digest) != digest:
            raise SystemExit(f"Annotation source checksum changed: {annotation}")
        # Dataset recordings/crops from one event or cohort remain together, even
        # when encoded bytes differ. A future athlete-disjoint split can refine this.
        split_group = marked.get("split_group") or digest
        if digest in hash_groups:
            parents[root(split_group)] = root(hash_groups[digest])
        hash_groups[digest] = split_group
        sources.append(
            {
                "hash": digest,
                "job_id": directory.name,
                "reviewer": marked["reviewer"],
                "license": marked["license"],
                "credit": marked.get("source_credit"),
                "split_group": split_group,
            }
        )
        for label in marked["labels"]:
            for start in range(
                label["start_ms"], label["end_ms"] - args.window_ms + 1, args.window_ms // 2
            ):
                vector = temporal_features(result["frames"], start, start + args.window_ms)
                if vector is not None:
                    examples.append(vector)
                    labels.append(label["label"])
                    groups.append(split_group)
    groups = [root(value) for value in groups]
    counts = Counter(labels)
    if len(counts) < 2 or min(counts.values(), default=0) < 20:
        raise SystemExit(
            f"Need at least two gesture classes with 20 reviewed visible windows each. Available: {dict(counts)}; skipped {skipped_provisional} provisional files. Label more footage; no model was promoted."
        )
    per_class = {
        label: len({group for group, value in zip(groups, labels) if value == label})
        for label in counts
    }
    if min(per_class.values()) < 3:
        raise SystemExit(
            f"Need at least three independent source groups per class. Available: {per_class}. Related clips and crops do not count separately."
        )
    x = np.asarray(examples)
    y = np.asarray(labels)
    group = np.asarray(groups)
    split = None
    for train, held_out in GroupShuffleSplit(n_splits=100, test_size=0.25, random_state=740).split(
        x, y, group
    ):
        if set(y[train]) == set(y[held_out]) == set(counts):
            split = train, held_out
            break
    if split is None:
        raise SystemExit("No independent video split covers all classes. Add more labeled videos.")
    train, held_out = split
    scaler = StandardScaler().fit(x[train])
    classifier = LogisticRegression(max_iter=2000, class_weight="balanced", random_state=740).fit(
        scaler.transform(x[train]), y[train]
    )
    predictions = classifier.predict(scaler.transform(x[held_out]))
    score = float(f1_score(y[held_out], predictions, average="macro"))
    evaluation = {
        "macro_f1": score,
        "accuracy": float(accuracy_score(y[held_out], predictions)),
        "classification_report": classification_report(
            y[held_out], predictions, output_dict=True, zero_division=0
        ),
        "train_groups": sorted(set(group[train])),
        "held_out_groups": sorted(set(group[held_out])),
        "train_windows": len(train),
        "held_out_windows": len(held_out),
        "split": "source_cohort_or_video_sha256",
    }
    version = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    promoted = bool(args.promote and score >= 0.75)
    model = {
        "schema": "fencecoach-linear-v1",
        "version": version,
        "promoted": promoted,
        "features": list(FEATURES),
        "window_ms": args.window_ms,
        "stride_ms": args.window_ms // 2,
        "classes": classifier.classes_.tolist(),
        "weights": classifier.coef_.tolist(),
        "intercept": classifier.intercept_.tolist(),
        "mean": scaler.mean_.tolist(),
        "scale": scaler.scale_.tolist(),
        "evaluation": evaluation,
        "class_windows": dict(counts),
        "sources": sources,
        "limitations": [
            "Human labels may contain errors.",
            "Single source-video split is not a generalization guarantee.",
            "2D pose classification requires matching capture conditions.",
            "Scores are not calibrated accuracy.",
        ],
    }
    destination = (
        args.output if promoted else args.output.with_name(args.output.stem + "-candidate.json")
    )
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(model, indent=2), encoding="utf-8")
    print(
        json.dumps(
            {
                "path": str(destination),
                "promoted": promoted,
                "held_out_macro_f1": score,
                "counts": dict(counts),
            }
        )
    )
    if args.promote and not promoted:
        raise SystemExit(
            "Promotion refused: held-out macro F1 below .75. Existing active model preserved."
        )


if __name__ == "__main__":
    main()
