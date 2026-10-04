from __future__ import annotations

import json
import re
import shutil
from contextlib import closing

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from fencecoach.gestures import Annotations
from fencecoach.storage import ensure, publish_source
from fencecoach.video_jobs import MAX_BYTES, AcceptReview, CaptureProfile, Crop, availability


def video_router(jobs, settings):
    router = APIRouter(prefix="/api/videos", tags=["video"])

    def require_worker():
        if not availability(settings.fencecoach_pose_model)["available"]:
            raise HTTPException(
                503,
                "Video setup is incomplete. Install .[video], run scripts/setup_video.py, and restart the server.",
            )

    def get_job(job_id):
        if not re.fullmatch(r"[a-f0-9]{32}", job_id):
            raise HTTPException(404, "Analysis not found.")
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(404, "Analysis not found.")
        return job

    @router.get("")
    def list_jobs():
        return jobs.list()

    @router.post("", status_code=202)
    async def upload_video(
        file: UploadFile = File(...),
        title: str = Form("Lunge practice", min_length=1, max_length=100),
        skill_level: str = Form("beginner"),
        crop: str = Form("{}"),
        capture_profile: str = Form("{}"),
    ):
        require_worker()
        if skill_level not in {"beginner", "intermediate"}:
            raise HTTPException(422, "Choose beginner or intermediate.")
        try:
            roi = Crop.model_validate_json(crop)
            profile = CaptureProfile.model_validate_json(capture_profile)
        except ValidationError as exc:
            raise HTTPException(422, "Choose a valid crop inside the frame.") from exc
        job = None
        try:
            job = jobs.create(title.strip() or "Lunge practice", skill_level, roi, profile=profile)
            directory = jobs.directory / job["job_id"]
            directory.mkdir(parents=True)
            size = 0
            with (directory / "source.video").open("wb") as target:
                while chunk := await file.read(1024 * 1024):
                    size += len(chunk)
                    if size > MAX_BYTES:
                        raise HTTPException(413, "Choose a video smaller than 200 MB.")
                    target.write(chunk)
            if not size:
                raise HTTPException(422, "This video file is empty.")
            await run_in_threadpool(publish_source, directory, job["job_id"])
            return jobs.update(
                job["job_id"],
                expected_status="receiving",
                status="queued",
                stage="Waiting for analysis",
                bytes=size,
            )
        except ValueError as exc:
            raise HTTPException(429, str(exc)) from exc
        except Exception:
            if job:
                jobs.update(
                    job["job_id"],
                    status="failed",
                    stage="Upload failed",
                    error="The upload was interrupted. Upload the original clip again.",
                )
                (jobs.directory / job["job_id"] / "source.video").unlink(missing_ok=True)
            raise
        finally:
            await file.close()

    @router.post("/demo", status_code=202)
    def real_demo():
        require_worker()
        source = jobs.directory.parent / "video-demo" / "mit-jump-lunge.mp4"
        if not source.is_file():
            raise HTTPException(503, "Public demo missing. Run scripts/setup_video.py --demo.")
        existing = next(
            (
                j
                for j in jobs.list()
                if j["source"] == "mit_ocw"
                and j["status"] in {"queued", "running", "review_ready", "completed"}
            ),
            None,
        )
        if existing:
            return existing
        try:
            job = jobs.create("MIT / Jump lunge demonstration", "beginner", Crop(), "mit_ocw")
        except ValueError as exc:
            raise HTTPException(429, str(exc)) from exc
        directory = jobs.directory / job["job_id"]
        try:
            directory.mkdir(parents=True)
            shutil.copyfile(source, directory / "source.video")
            publish_source(directory, job["job_id"])
            return jobs.update(
                job["job_id"],
                status="queued",
                stage="Waiting for analysis",
                bytes=source.stat().st_size,
            )
        except Exception:
            jobs.update(job["job_id"], status="failed", error="Could not prepare the public demo.")
            raise

    @router.get("/{job_id}")
    def status(job_id: str):
        return get_job(job_id)

    @router.get("/{job_id}/result")
    def result(job_id: str):
        job = get_job(job_id)
        if job["status"] not in {"review_ready", "completed"}:
            raise HTTPException(409, "Analysis is not ready.")
        return json.loads(
            ensure(jobs.directory / job_id, job, "result.json").read_text(encoding="utf-8")
        )

    @router.get("/{job_id}/annotations")
    def annotations(job_id: str):
        job = get_job(job_id)
        if job.get("annotations") is not None:
            return job["annotations"]
        path = jobs.directory / job_id / "annotations.json"
        return (
            json.loads(path.read_text(encoding="utf-8"))
            if path.is_file()
            else {"labels": [], "reviewer": "athlete"}
        )

    @router.put("/{job_id}/annotations")
    def save_annotations(job_id: str, data: Annotations):
        analysis = result(job_id)
        ordered = sorted(data.labels, key=lambda label: label.start_ms)
        if any(label.end_ms > analysis["duration_ms"] for label in ordered):
            raise HTTPException(422, "A label extends past the clip.")
        if any(a.end_ms > b.start_ms for a, b in zip(ordered, ordered[1:])):
            raise HTTPException(422, "Gesture labels cannot overlap.")
        payload = data.model_dump()
        payload.update(
            job_id=job_id,
            model_sha256=analysis["model_sha256"],
            source=analysis["source"],
            source_credit=analysis.get("source_credit"),
            license="CC BY-NC-SA 3.0" if analysis["source"] == "mit_ocw" else "user_supplied",
        )
        jobs.update(job_id, annotations=payload)
        path = jobs.directory / job_id / "annotations.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_suffix(".tmp")
        temp.write_text(json.dumps(payload), encoding="utf-8")
        temp.replace(path)
        return payload

    @router.get("/{job_id}/dataset")
    def dataset(job_id: str):
        analysis = result(job_id)
        return {
            "schema": "fencecoach-labeled-poses-v1",
            "annotation": annotations(job_id),
            "frames": analysis["frames"],
            "width": analysis["width"],
            "height": analysis["height"],
            "pipeline_version": analysis.get("pipeline_version"),
            "source_credit": analysis.get("source_credit"),
        }

    @router.get("/{job_id}/preview")
    def preview(job_id: str):
        job = get_job(job_id)
        if job["status"] not in {"review_ready", "completed"}:
            raise HTTPException(409, "Preview is not ready.")
        return FileResponse(
            ensure(jobs.directory / job_id, job, "preview.mp4"),
            media_type="video/mp4",
            headers={"Cache-Control": "private, no-cache"},
        )

    @router.get("/{job_id}/poster")
    def poster(job_id: str):
        job = get_job(job_id)
        path = (
            ensure(jobs.directory / job_id, job, "poster.jpg")
            if job["status"] in {"review_ready", "completed"}
            else jobs.directory / job_id / "poster.jpg"
        )
        if job["status"] not in {"review_ready", "completed"} or not path.is_file():
            raise HTTPException(404, "Poster is not ready.")
        return FileResponse(
            path, media_type="image/jpeg", headers={"Cache-Control": "private, no-cache"}
        )

    @router.post("/{job_id}/retry", status_code=202)
    def retry(job_id: str):
        require_worker()
        get_job(job_id)
        if not ensure(jobs.directory / job_id, get_job(job_id), "source.video").is_file():
            raise HTTPException(409, "Upload the clip again; the source file is missing.")
        with closing(jobs.connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT payload FROM video_jobs WHERE id=?", (job_id,)).fetchone()
            job = json.loads(row[0])
            if job["status"] != "failed":
                raise HTTPException(409, "Only failed jobs can be retried.")
            if (
                db.execute(
                    "SELECT count(*) FROM video_jobs WHERE status IN ('queued','running')"
                ).fetchone()[0]
                >= settings.fencecoach_queue_limit
            ):
                raise HTTPException(429, "The local queue is full.")
            job.update(
                status="queued",
                error=None,
                progress=0,
                stage="Waiting for analysis",
                attempts=0,
                owner=None,
            )
            db.execute(
                "UPDATE video_jobs SET status='queued',payload=? WHERE id=?",
                (json.dumps(job), job_id),
            )
        return job

    @router.post("/{job_id}/cancel")
    def cancel(job_id: str):
        get_job(job_id)
        try:
            return jobs.cancel(job_id)
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc

    @router.post("/{job_id}/accept", status_code=201)
    def accept(job_id: str, review: AcceptReview):
        get_job(job_id)
        try:
            return jobs.accept(job_id, review, result(job_id))
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc

    return router


class UploadLimit:
    """Bound multipart bytes as they arrive, including requests without Content-Length."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if (
            scope["type"] != "http"
            or scope.get("path") != "/api/videos"
            or scope.get("method") != "POST"
        ):
            return await self.app(scope, receive, send)
        consumed = 0

        async def limited_receive():
            nonlocal consumed
            message = await receive()
            consumed += len(message.get("body", b""))
            if consumed > MAX_BYTES + 65536:
                raise HTTPException(413, "Choose a video smaller than 200 MB.")
            return message

        await self.app(scope, limited_receive, send)
