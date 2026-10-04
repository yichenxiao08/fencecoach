"""Optional private S3 artifacts let independent workers use separate local caches."""

from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from fencecoach.settings import settings


def client():
    import boto3
    from botocore.config import Config

    return boto3.client(
        "s3",
        region_name=settings.aws_region,
        endpoint_url=settings.fencecoach_s3_endpoint or None,
        config=Config(connect_timeout=10, read_timeout=60, retries={"max_attempts": 3}),
    )


def key(job_id, name, version=None):
    prefix = settings.fencecoach_s3_prefix.strip("/")
    return f"{prefix}/{job_id}/{name}" if not version else f"{prefix}/{job_id}/{version}/{name}"


def publish_source(directory: Path, job_id):
    if settings.fencecoach_s3_bucket:
        client().upload_file(
            str(directory / "source.video"),
            settings.fencecoach_s3_bucket,
            key(job_id, "source.video"),
            ExtraArgs={"ServerSideEncryption": "AES256"},
        )


def ensure(directory: Path, job, name):
    path = directory / name
    version = job.get("artifact_version") if name != "source.video" else None
    marker = directory / (name + ".version")
    if path.is_file() and (
        not settings.fencecoach_s3_bucket
        or name == "source.video"
        or (marker.is_file() and marker.read_text() == str(version))
    ):
        return path
    if not settings.fencecoach_s3_bucket:
        return path
    directory.mkdir(parents=True, exist_ok=True)
    temporary = directory / (name + "." + uuid4().hex + ".tmp")
    try:
        client().download_file(
            settings.fencecoach_s3_bucket, key(job["job_id"], name, version), str(temporary)
        )
        temporary.replace(path)
        marker.write_text(str(version))
    finally:
        temporary.unlink(missing_ok=True)
    return path


def publish_analysis(directory: Path, job_id, owner):
    if not settings.fencecoach_s3_bucket:
        return None
    s3 = client()
    for name in ("result.json", "preview.mp4", "poster.jpg"):
        s3.upload_file(
            str(directory / name),
            settings.fencecoach_s3_bucket,
            key(job_id, name, owner),
            ExtraArgs={"ServerSideEncryption": "AES256"},
        )
    return owner
