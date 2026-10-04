"""Timestamped 2D pose evidence and deliberately conservative recovery proposals."""

from __future__ import annotations

import hashlib
import json
import math
import time
from pathlib import Path
from statistics import median

from fencecoach.gestures import classify_windows
from fencecoach.motion import clip_summary, enrich_candidates, footwork_proposals, frame_features
from fencecoach.settings import settings
from fencecoach.video_jobs import MAX_SECONDS, METHOD, MODEL_SHA
from fencecoach.video_preview import build_preview, upright_frame

SAMPLE_INTERVAL_MS = 1000 / 12
KEYPOINTS = (23, 24, 25, 26, 27, 28)


def angle(a, b, c):
    u, v = (a[0] - b[0], a[1] - b[1]), (c[0] - b[0], c[1] - b[1])
    denominator = math.hypot(*u) * math.hypot(*v)
    return (
        round(
            math.degrees(math.acos(max(-1, min(1, (u[0] * v[0] + u[1] * v[1]) / denominator)))), 1
        )
        if denominator > 1e-8
        else None
    )


def proposals(frames):
    valid = [f for f in frames if f.get("features")]
    if len(valid) < 10:
        return [], None
    # Initial guard is a recording assumption, not a fencing classification model.
    initial = [f["features"]["stance_ratio"] for f in valid if f["time_ms"] <= 1500]
    if len(initial) < 5:
        return [], None
    baseline = median(initial)
    threshold = max(baseline * 1.3, baseline + 0.3)
    return_band = baseline + 0.20
    candidates, active, stable, previous = [], None, None, None
    for frame in frames:
        features = frame.get("features")
        t = frame["time_ms"]
        if not features or (previous is not None and t - previous > 300):
            active, stable = None, None
        previous = t
        if not features:
            continue
        stance = features["stance_ratio"]
        if active is None:
            if stance > threshold:
                active = dict(peak=frame, quality=[frame["quality"]], started=t)
            continue
        active["quality"].append(frame["quality"])
        if stance > active["peak"]["features"]["stance_ratio"]:
            active["peak"] = frame
            stable = None
        if stance <= return_band:
            stable = t if stable is None else stable
            if t - stable >= 333:
                start = active["peak"]["time_ms"]
                if 250 <= stable - start <= 6000:
                    candidates.append(
                        dict(
                            candidate_id=f"recovery-{len(candidates) + 1:02}",
                            start_ms=start,
                            end_ms=stable,
                            quality=round(sum(active["quality"]) / len(active["quality"]), 3),
                            peak_stance_ratio=active["peak"]["features"]["stance_ratio"],
                            label="Peak stance → return to initial stance band",
                        )
                    )
                active, stable = None, None
        else:
            stable = None
        if active and t - active["started"] > 8000:
            active, stable = None, None
    return candidates, round(baseline, 4)


def analyze(jobs, job_id: str, model: Path):
    import av
    import mediapipe as mp
    import numpy as np
    from mediapipe.tasks.python import BaseOptions
    from mediapipe.tasks.python.vision import (
        PoseLandmarker,
        PoseLandmarkerOptions,
        RunningMode,
    )

    if not model.is_file():
        raise ValueError("Pose model missing. Run scripts/setup_video.py before analysis.")
    sha = hashlib.sha256(model.read_bytes()).hexdigest()
    if sha != MODEL_SHA:
        raise ValueError("Pose model checksum differs from the pinned model. Run setup_video.py.")
    job = jobs.get(job_id)
    started = time.perf_counter()
    directory = jobs.directory / job_id
    crop = job["crop"]
    frames, ambiguous, missing, jumps = [], 0, 0, 0
    start_time = None
    previous_timestamp = -1
    next_sample = 0
    previous_center = None
    previous_pose_time = None
    jobs.update(job_id, stage="Preparing smooth video playback", progress=5)
    preview = build_preview(
        directory / "source.video",
        directory,
        lambda fraction: jobs.update(job_id, progress=5 + round(25 * fraction)),
    )
    inference_ms = 0
    options = PoseLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(model)),
        running_mode=RunningMode.VIDEO,
        num_poses=2,
        min_pose_detection_confidence=0.6,
        min_pose_presence_confidence=0.6,
        min_tracking_confidence=0.6,
    )
    jobs.update(job_id, stage="Tracking body landmarks", progress=30)
    with av.open(str(directory / "source.video")) as container:
        if not container.streams.video:
            raise ValueError("The uploaded file has no video stream.")
        stream = container.streams.video[0]
        if stream.width * stream.height > 3840 * 2160:
            raise ValueError("Use footage at 4K resolution or below.")
        if container.duration and container.duration / av.time_base > MAX_SECONDS + 1:
            raise ValueError(f"Use a clip of {MAX_SECONDS} seconds or less.")
        duration_hint = container.duration / av.time_base if container.duration else MAX_SECONDS
        with PoseLandmarker.create_from_options(options) as landmarker:
            for count, frame in enumerate(container.decode(stream)):
                if frame.width * frame.height > 3840 * 2160:
                    raise ValueError("Use footage at 4K resolution or below.")
                if count > 18000:
                    raise ValueError("Too many decoded frames. Export a shorter clip.")
                if frame.pts is None or frame.time_base is None:
                    raise ValueError(
                        "Video timestamps are missing. Export it as MP4 and try again."
                    )
                timestamp = float(frame.pts * frame.time_base)
                if start_time is None:
                    start_time = timestamp
                t = round((timestamp - start_time) * 1000)
                if t > MAX_SECONDS * 1000:
                    raise ValueError(f"Use a clip of {MAX_SECONDS} seconds or less.")
                if t < previous_timestamp:
                    raise ValueError("Video timestamps went backwards. Export a fresh MP4.")
                previous_timestamp = t
                if t + 0.5 < next_sample:
                    continue
                while next_sample <= t + 0.5:
                    next_sample += SAMPLE_INTERVAL_MS
                rgb = upright_frame(frame).to_ndarray(format="rgb24")
                h, w = rgb.shape[:2]
                x, y = int(crop["x"] * w), int(crop["y"] * h)
                cw, ch = int(crop["width"] * w), int(crop["height"] * h)
                roi = np.ascontiguousarray(rgb[y : y + ch, x : x + cw])
                if max(cw, ch) > 960:
                    scale = 960 / max(cw, ch)
                    roi = (
                        av.VideoFrame.from_ndarray(roi, format="rgb24")
                        .reformat(max(1, round(cw * scale)), max(1, round(ch * scale)))
                        .to_ndarray(format="rgb24")
                    )
                inference_started = time.perf_counter()
                result = landmarker.detect_for_video(
                    mp.Image(image_format=mp.ImageFormat.SRGB, data=roi), t
                )
                inference_ms += (time.perf_counter() - inference_started) * 1000
                item = dict(time_ms=t, landmarks=[], quality=0, features=None)
                if len(result.pose_landmarks) > 1:
                    ambiguous += 1
                    previous_center = None
                elif not result.pose_landmarks:
                    missing += 1
                    previous_center = None
                else:
                    pose = result.pose_landmarks[0]
                    landmarks = [
                        [
                            round((p.x * cw + x) / w, 5),
                            round((p.y * ch + y) / h, 5),
                            round(p.z, 5),
                            round(p.visibility, 4),
                            round(p.presence, 4),
                        ]
                        for p in pose
                    ]
                    item["landmarks"] = landmarks
                    quality = min(min(pose[i].visibility, pose[i].presence) for i in KEYPOINTS)
                    center = (
                        (landmarks[23][0] + landmarks[24][0]) / 2,
                        (landmarks[23][1] + landmarks[24][1]) / 2,
                    )
                    discontinuity = (
                        previous_center
                        and previous_pose_time is not None
                        and t - previous_pose_time < 300
                        and math.dist(center, previous_center) > 0.3
                    )
                    previous_center, previous_pose_time = center, t
                    if discontinuity:
                        jumps += 1
                        item["landmarks"] = []
                    elif quality >= 0.5:
                        item["features"] = frame_features(landmarks, w, h)
                        if item["features"]:
                            item["quality"] = round(quality, 4)
                frames.append(item)
                if len(frames) % 12 == 0:
                    jobs.update(
                        job_id,
                        progress=min(94, round(30 + 64 * t / (duration_hint * 1000))),
                        stage="Tracking body landmarks",
                        sampled_frames=len(frames),
                    )
    if len(frames) < 6:
        raise ValueError("Use at least one second of decodable video.")
    candidates, baseline = proposals(frames)
    if baseline is not None:
        enrich_candidates(frames, candidates, baseline)
    warnings = [
        "Angles and torso tilt are 2D estimates, not spinal straightness or a technique verdict.",
        "Arm extension is measured at a proposed movement onset, not weapon contact or attack intent.",
        "Unvalidated 2D motion heuristic. Review every proposed interval.",
        "Start in en garde for 1.5 seconds; recovery means return to that stance band.",
        "Tracking quality is a visibility/presence proxy, not probability of correctness.",
    ]
    if ambiguous:
        warnings.append(
            f"Multiple people detected in {ambiguous} sampled frames; those frames were excluded. Use a crop or a solo clip."
        )
    if missing:
        warnings.append(f"No pose detected in {missing} sampled frames.")
    if jumps:
        warnings.append(f"Excluded {jumps} frames with possible athlete identity changes.")
    if not candidates:
        warnings.append(
            "No complete recovery could be proposed reliably. Mark peak and recovery times manually, or try clearer footage."
        )
    gestures, gesture_model = classify_windows(frames, settings.fencecoach_gesture_model)
    duration = preview["duration_ms"]
    payload = dict(
        job_id=job_id,
        method=METHOD,
        model_sha256=sha,
        duration_ms=duration,
        width=w,
        height=h,
        sample_interval_ms=SAMPLE_INTERVAL_MS,
        preview=preview,
        pipeline_version="video-v3",
        pose_input_max_dimension=960,
        performance=dict(
            pose_inference_ms=round(inference_ms),
            total_ms=round((time.perf_counter() - started) * 1000),
        ),
        frames=frames,
        clip_measurements=clip_summary(frames),
        initial_guard_measurements=clip_summary([f for f in frames if f["time_ms"] <= 1500])
        if job.get("capture_profile", {}).get("initial_guard_confirmed")
        else [],
        capture_profile=job.get("capture_profile", {}),
        footwork_events=footwork_proposals(frames, baseline, job.get("capture_profile", {})),
        gestures=gestures,
        gesture_model=gesture_model,
        candidates=candidates,
        baseline_stance_ratio=baseline,
        warnings=warnings,
        tracked_frames=sum(bool(f["features"]) for f in frames),
        sampled_frames=len(frames),
        source=job["source"],
        source_credit="MIT OpenCourseWare · PE.740 Fencing (Spring 2007) · Prof. Jaroslav Koniusz"
        if job["source"] == "mit_ocw"
        else None,
    )
    temporary = directory / "result.tmp"
    temporary.write_text(json.dumps(payload, allow_nan=False), encoding="utf-8")
    temporary.replace(directory / "result.json")
    jobs.update(
        job_id,
        duration_ms=duration,
        sampled_frames=len(frames),
        tracked_frames=payload["tracked_frames"],
        candidate_count=len(candidates),
        preview_revision=preview["revision"],
        preview_version=preview["version"],
    )
