"""Reviewed labels and safe JSON inference for a separately trained temporal classifier."""

from __future__ import annotations

import json
import math
from pathlib import Path
from statistics import mean, pstdev
from typing import Literal

from pydantic import BaseModel, Field, model_validator

LABELS = ("en_garde", "advance", "retreat", "lunge", "recovery", "other")
FEATURES = (
    "stance_ratio",
    "left_knee_angle",
    "right_knee_angle",
    "torso_tilt",
    "left_elbow_angle",
    "right_elbow_angle",
    "left_arm_extension",
    "right_arm_extension",
)


class GestureLabel(BaseModel):
    start_ms: int = Field(ge=0)
    end_ms: int = Field(gt=0)
    label: Literal["en_garde", "advance", "retreat", "lunge", "recovery", "other"]
    note: str = Field(default="", max_length=300)

    @model_validator(mode="after")
    def ordered(self):
        if self.end_ms <= self.start_ms:
            raise ValueError("Label end must follow start.")
        return self


class Annotations(BaseModel):
    labels: list[GestureLabel] = Field(default_factory=list, max_length=250)
    reviewer: str = Field(default="athlete", min_length=1, max_length=100)


def temporal_features(frames, start, end):
    selected = [f for f in frames if start <= f["time_ms"] <= end]
    valid = [f for f in selected if f.get("features")]
    if len(valid) < 6 or len(valid) / max(1, len(selected)) < 0.8:
        return None
    if any(b["time_ms"] - a["time_ms"] > 300 for a, b in zip(valid, valid[1:])):
        return None
    vector = []
    for key in FEATURES:
        values = [f["features"].get(key) for f in valid]
        values = [v for v in values if v is not None]
        # Missing upper-body values cause abstention rather than fabricated zeros.
        if len(values) < 0.8 * len(valid):
            return None
        vector.extend(
            (mean(values), pstdev(values), min(values), max(values), values[-1] - values[0])
        )
    return vector


def classify_windows(frames, path: Path):
    if not path.is_file():
        return [], {"ready": False, "reason": "No gesture model has been trained and promoted."}
    try:
        model = json.loads(path.read_text(encoding="utf-8"))
        expected = len(FEATURES) * 5
        valid = (
            model.get("features") == list(FEATURES)
            and len(model["mean"]) == len(model["scale"]) == expected
            and all(math.isfinite(v) for v in model["mean"])
            and all(math.isfinite(v) and v > 0 for v in model["scale"])
            and len(model["weights"]) == len(model["intercept"])
            and len(model["classes"]) >= 2
            and len(model["weights"]) in {1, len(model["classes"])}
            and all(label in LABELS for label in model["classes"])
            and all(
                len(row) == expected and all(math.isfinite(v) for v in row)
                for row in model["weights"]
            )
        )
        if not valid:
            raise ValueError("Invalid model dimensions or features.")
    except (OSError, ValueError, KeyError, TypeError):
        return [], {
            "ready": False,
            "reason": "The gesture model file is invalid. Pose analysis is still available.",
        }
    if model.get("schema") != "fencecoach-linear-v1" or not model.get("promoted"):
        return [], {"ready": False, "reason": "Model has not passed promotion checks."}
    output = []
    duration = frames[-1]["time_ms"] if frames else 0
    for start in range(0, duration - 999, 500):
        vector = temporal_features(frames, start, start + 1000)
        if vector is None:
            continue
        normalized = [(v - m) / s for v, m, s in zip(vector, model["mean"], model["scale"])]
        scores = [
            b + sum(w * x for w, x in zip(weights, normalized))
            for weights, b in zip(model["weights"], model["intercept"])
        ]
        if len(scores) == 1:
            p = 1 / (1 + math.exp(-max(-500, min(500, scores[0]))))
            probabilities = [1 - p, p]
        else:
            exps = [math.exp(v - max(scores)) for v in scores]
            probabilities = [v / sum(exps) for v in exps]
        winner = max(range(len(probabilities)), key=probabilities.__getitem__)
        score = probabilities[winner]
        output.append(
            dict(
                start_ms=start,
                end_ms=start + 1000,
                label=model["classes"][winner] if score >= 0.75 else "uncertain",
                model_score=round(score, 3),
                source="trained_temporal_classifier",
                model_version=model["version"],
            )
        )
    return output, {
        "ready": True,
        "version": model["version"],
        "held_out": model["evaluation"],
        "note": "Model scores are uncalibrated; review classifications.",
    }
