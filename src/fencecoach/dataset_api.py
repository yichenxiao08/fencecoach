"""Local dataset review, with separate footwork, blade and tactical label tracks."""

from __future__ import annotations

import json
import re
import threading
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, model_validator

from fencecoach.data_policy import eligible_source
from fencecoach.video_jobs import Crop

ONTOLOGY = {
    "footwork": (
        "en_garde",
        "advance",
        "retreat",
        "lunge",
        "recovery",
        "fleche",
        "jump_forward",
        "jump_back",
        "bounce",
        "shuffle",
        "other",
        "unknown",
    ),
    "bladework": ("extension", "thrust", "parry", "other", "unknown"),
    "tactics": ("attack", "counterattack", "riposte", "remise", "other", "unknown"),
}
LOCK = threading.RLock()


class DatasetSegment(BaseModel):
    start_ms: int = Field(ge=0)
    end_ms: int = Field(gt=0)
    layer: Literal["footwork", "bladework", "tactics"]
    label: str
    track_id: str = Field(min_length=1, max_length=60)
    status: Literal["provisional", "reviewed", "rejected"] = "provisional"
    origin: Literal["assistant_visual", "human", "published_dataset", "heuristic"] = "human"
    confidence: Literal["low", "medium", "high"] = "medium"
    boundary_uncertainty_ms: int = Field(default=250, ge=0, le=5000)
    note: str = Field(default="", max_length=500)

    @model_validator(mode="after")
    def validate_label(self):
        if self.end_ms <= self.start_ms or self.label not in ONTOLOGY[self.layer]:
            raise ValueError("Choose a supported label and an ordered interval.")
        return self


class DatasetAnnotations(BaseModel):
    revision: int = Field(default=0, ge=0)
    reviewer: str = Field(default="unreviewed", min_length=1, max_length=100)
    reviewer_role: Literal["assistant", "athlete", "coach"] = "athlete"
    track_description: str = Field(default="", max_length=500)
    weapon: Literal["unknown", "foil", "epee", "sabre"] = "unknown"
    facing: Literal["unknown", "left", "right"] = "unknown"
    camera_motion: Literal["unknown", "fixed", "moving"] = "unknown"
    opponent_visible: bool = False
    crop: Crop = Field(default_factory=Crop)
    segments: list[DatasetSegment] = Field(default_factory=list, max_length=1000)

    @model_validator(mode="after")
    def validate_review(self):
        ordered = sorted(self.segments, key=lambda s: (s.track_id, s.layer, s.start_ms))
        for segment in ordered:
            if segment.status == "reviewed" and (
                self.reviewer_role == "assistant"
                or self.reviewer.strip() == "unreviewed"
                or not self.reviewer.strip()
            ):
                raise ValueError("Reviewed labels require an identified human reviewer.")
            if (
                segment.layer == "tactics"
                and segment.status == "reviewed"
                and (self.reviewer_role != "coach" or not self.opponent_visible)
            ):
                raise ValueError(
                    "Tactical ground truth requires a coach and visible opponent context."
                )
        for a, b in zip(ordered, ordered[1:]):
            if a.layer == b.layer and a.track_id == b.track_id and a.end_ms > b.start_ms:
                raise ValueError("Labels overlap within the same athlete and layer.")
        return self


def dataset_router(root: Path):
    root = root.resolve()
    router = APIRouter(prefix="/api/datasets", tags=["training data"])

    def folder(collection, clip_id):
        if collection not in {"mit-ocw", "commons", "footwork-clips"} or not re.fullmatch(
            r"[a-z0-9_-]{1,100}", clip_id
        ):
            raise HTTPException(404, "Dataset clip not found.")
        path = (root / collection / clip_id).resolve()
        if not path.is_relative_to(root) or not (path / "source.json").is_file():
            raise HTTPException(404, "Dataset clip not found.")
        return path

    def annotations(path):
        file = path / "labels.json"
        return (
            json.loads(file.read_text(encoding="utf-8"))
            if file.is_file()
            else DatasetAnnotations().model_dump()
        )

    @router.get("")
    def inventory(include_excluded: bool = False):
        clips, counts = [], Counter()
        excluded = 0
        for file in sorted(root.glob("*/*/source.json")):
            source = json.loads(file.read_text(encoding="utf-8"))
            eligible = eligible_source(source)
            if not eligible:
                excluded += 1
                if not include_excluded:
                    continue
            marked = annotations(file.parent)
            statuses = Counter(s["status"] for s in marked["segments"])
            counts.update(statuses)
            clips.append(
                {
                    **source,
                    "training_eligible": eligible,
                    "collection": file.parent.parent.name,
                    "annotation_counts": dict(statuses),
                    "prepared": (file.parent / "prepared/result.json").is_file(),
                }
            )
        return dict(
            clips=clips,
            ontology=ONTOLOGY,
            annotation_counts=dict(counts),
            excluded_sources=excluded,
            note="Only inspected modern sport fencing sources are eligible. Provisional labels remain excluded from training; historical and unreviewed footage are blocked.",
        )

    @router.get("/{collection}/{clip_id}/labels")
    def read_labels(collection: str, clip_id: str):
        return annotations(folder(collection, clip_id))

    @router.put("/{collection}/{clip_id}/labels")
    def save_labels(collection: str, clip_id: str, data: DatasetAnnotations):
        path = folder(collection, clip_id)
        source = json.loads((path / "source.json").read_text(encoding="utf-8"))
        ordered = sorted(data.segments, key=lambda s: (s.track_id, s.layer, s.start_ms))
        for segment in ordered:
            if segment.end_ms > source["duration_ms"]:
                raise HTTPException(422, "A label extends past the source video.")
        with LOCK:
            previous = annotations(path)
            if previous["revision"] != data.revision:
                raise HTTPException(409, "Labels changed. Reload before saving.")
            payload = data.model_dump()
            payload.update(
                revision=data.revision + 1,
                source_sha256=source["sha256"],
                updated_at=datetime.now(UTC).isoformat(),
            )
            history = path / "label-history"
            history.mkdir(exist_ok=True)
            (history / f"{uuid4().hex}.json").write_text(
                json.dumps(dict(before=previous, after=payload), indent=2), encoding="utf-8"
            )
            temp = path / f"labels-{uuid4().hex}.tmp"
            temp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
            temp.replace(path / "labels.json")
        return payload

    @router.get("/{collection}/{clip_id}/source")
    def source_video(collection: str, clip_id: str):
        path = folder(collection, clip_id)
        record = json.loads((path / "source.json").read_text(encoding="utf-8"))
        file = path / ("source.mp4" if (path / "source.mp4").exists() else "source.video")
        if not file.is_file():
            raise HTTPException(404, "Source download is unavailable.")
        extension = Path(record["filename"]).suffix
        mime = {".mp4": "video/mp4", ".webm": "video/webm", ".ogv": "video/ogg"}.get(extension)
        return FileResponse(file, media_type=mime)

    @router.get("/{collection}/{clip_id}/poses")
    def poses(collection: str, clip_id: str):
        path = folder(collection, clip_id) / "prepared/result.json"
        if not path.is_file():
            raise HTTPException(409, "Prepare the selected athlete crop first.")
        return FileResponse(path, media_type="application/json")

    return router
