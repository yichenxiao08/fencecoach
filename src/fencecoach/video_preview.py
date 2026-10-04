"""Browser preview encoding is independent of the pose inference sampling rate."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import time
from fractions import Fraction
from pathlib import Path

from fencecoach.video_jobs import MAX_SECONDS

PREVIEW_VERSION = "preview-v2"
PREVIEW_MAX_FPS = 30
PREVIEW_MAX_DIMENSION = 960
VIDEO_TIME_BASE = Fraction(1, 90000)


def upright_frame(frame):
    import av
    import numpy as np

    rotation = round(frame.rotation)
    if rotation % 90:
        raise ValueError("Unsupported video rotation. Export an upright MP4.")
    if not rotation:
        return frame
    pixels = np.rot90(frame.to_ndarray(format="rgb24"), k=rotation // 90).copy()
    return av.VideoFrame.from_ndarray(pixels, format="rgb24")


def build_preview(source: Path, directory: Path, on_progress=None):
    import av

    started = time.perf_counter()
    temporary = directory / "preview.encoding.mp4"
    poster_tmp = directory / "poster.encoding.jpg"
    first_time, previous_time = None, None
    next_frame = 0
    frame_count, previous_pts = 0, -1
    try:
        with av.open(str(source)) as container:
            if not container.streams.video:
                raise ValueError("The uploaded file has no video stream.")
            stream = container.streams.video[0]
            hint = container.duration / av.time_base if container.duration else MAX_SECONDS
            if hint > MAX_SECONDS + 1:
                raise ValueError(f"Use a clip of {MAX_SECONDS} seconds or less.")
            rate = stream.average_rate or Fraction(PREVIEW_MAX_FPS)
            rate = rate if 0 < rate <= PREVIEW_MAX_FPS else Fraction(PREVIEW_MAX_FPS)
            step = Fraction(1, PREVIEW_MAX_FPS)
            with av.open(str(temporary), "w", options={"movflags": "+faststart"}) as output:
                encoded, dimensions = None, None
                for count, frame in enumerate(container.decode(stream)):
                    if count > 18000:
                        raise ValueError("Too many decoded frames. Export a shorter clip.")
                    if frame.width * frame.height > 3840 * 2160:
                        raise ValueError("Use footage at 4K resolution or below.")
                    if frame.pts is None or frame.time_base is None:
                        raise ValueError("Video timestamps are missing. Export it as MP4.")
                    absolute = frame.pts * frame.time_base
                    first_time = absolute if first_time is None else first_time
                    timestamp = absolute - first_time
                    if timestamp > MAX_SECONDS:
                        raise ValueError(f"Use a clip of {MAX_SECONDS} seconds or less.")
                    if previous_time is not None and timestamp < previous_time:
                        raise ValueError("Video timestamps went backwards. Export a fresh MP4.")
                    previous_time = timestamp
                    # Preserve low-rate sources exactly; only cap high-rate footage at 30 fps.
                    if timestamp + Fraction(1, 2000) < next_frame:
                        continue
                    next_frame = (math.floor(timestamp / step + Fraction(1, 10000)) + 1) * step
                    pts = round(timestamp / VIDEO_TIME_BASE)
                    if pts <= previous_pts:
                        continue
                    upright = upright_frame(frame)
                    if dimensions is None:
                        dimensions = upright.width, upright.height
                        scale = min(1, PREVIEW_MAX_DIMENSION / max(dimensions))
                        width = max(2, int(upright.width * scale) // 2 * 2)
                        height = max(2, int(upright.height * scale) // 2 * 2)
                        encoded = output.add_stream("libx264", rate=rate)
                        encoded.width, encoded.height = width, height
                        encoded.pix_fmt = "yuv420p"
                        encoded.time_base = VIDEO_TIME_BASE
                        encoded.codec_context.time_base = VIDEO_TIME_BASE
                        encoded.codec_context.max_b_frames = 0
                        encoded.codec_context.gop_size = max(1, math.ceil(float(rate)))
                        encoded.codec_context.thread_count = 2
                        encoded.options = {
                            "crf": "23",
                            "preset": "veryfast",
                            "tune": "zerolatency",
                            "sc_threshold": "0",
                        }
                    elif dimensions != (upright.width, upright.height):
                        raise ValueError("Video dimensions changed mid-clip. Export a fresh MP4.")
                    preview_frame = upright.reformat(width, height, format="yuv420p")
                    preview_frame.pts, preview_frame.time_base = pts, VIDEO_TIME_BASE
                    if frame_count == 0:
                        preview_frame.to_image().save(poster_tmp, format="JPEG", quality=85)
                    for packet in encoded.encode(preview_frame):
                        output.mux(packet)
                    previous_pts = pts
                    frame_count += 1
                    if on_progress and frame_count % 15 == 0:
                        on_progress(min(1, float(timestamp) / max(hint, 1)))
                if encoded is None or frame_count < 2:
                    raise ValueError("The file contained too few decodable video frames.")
                for packet in encoded.encode():
                    output.mux(packet)
        with av.open(str(temporary)) as container:
            duration_ms = round(container.duration / av.time_base * 1000)
        with temporary.open("rb") as file:
            revision = hashlib.file_digest(file, "sha256").hexdigest()[:16]
        # Publication occurs only after the encoder closes and writes MP4's startup index.
        temporary.replace(directory / "preview.mp4")
        poster_tmp.replace(directory / "poster.jpg")
        return dict(
            version=PREVIEW_VERSION,
            revision=revision,
            width=width,
            height=height,
            frame_count=frame_count,
            fps_hint=float(rate),
            max_fps=PREVIEW_MAX_FPS,
            duration_ms=duration_ms,
            encoding_ms=round((time.perf_counter() - started) * 1000),
        )
    finally:
        temporary.unlink(missing_ok=True)
        poster_tmp.unlink(missing_ok=True)


def refresh_preview(job_id):
    """Upgrade playback assets without recomputing or changing reviewed measurement evidence."""
    from fencecoach.settings import settings
    from fencecoach.video_jobs import VideoJobs

    jobs = VideoJobs(settings.fencecoach_db_path, settings.fencecoach_video_dir)
    job = jobs.get(job_id)
    if not job or job["status"] not in {"review_ready", "completed"}:
        raise ValueError("Choose a completed analysis before upgrading its preview.")
    directory = jobs.directory / job["job_id"]
    result = json.loads((directory / "result.json").read_text(encoding="utf-8"))
    preview = build_preview(directory / "source.video", directory)
    result["preview"] = preview
    temporary = directory / "result.preview.tmp"
    temporary.write_text(json.dumps(result, allow_nan=False), encoding="utf-8")
    temporary.replace(directory / "result.json")
    jobs.update(job_id, preview_revision=preview["revision"], preview_version=PREVIEW_VERSION)
    print(json.dumps(preview))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--job", required=True, help="Upgrade an existing analysis's preview only.")
    refresh_preview(parser.parse_args().job)
