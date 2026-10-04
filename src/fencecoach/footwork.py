"""Lower-body temporal evidence, independent of shoulder and wrist visibility.

Lengths are image-plane leg lengths; velocities are not metres/second. Direction
uses declared facing. Absolute travel is masked unless the camera is declared fixed.
"""

from __future__ import annotations

import math
from statistics import mean, median

import numpy as np

from fencecoach.motion import joint_angle

VERSION = "footwork-v2"
LABELS = (
    "en_garde",
    "advance",
    "retreat",
    "lunge",
    "recovery",
    "bounce",
    "jump_forward",
    "jump_back",
    "shuffle",
    "other",
)
CHANNELS = (
    "stance_width",
    "hip_height",
    "left_knee",
    "right_knee",
    "left_foot_x",
    "right_foot_x",
    "left_foot_height",
    "right_foot_height",
    "left_foot_forward",
    "right_foot_forward",
    "hip_travel",
    "hip_vertical",
)
STATS = ("mean", "std", "min", "max", "change", "speed_mean", "speed_std", "speed_max", "coverage")
FEATURE_NAMES = tuple(f"{key}.{stat}" for key in CHANNELS for stat in STATS) + (
    "visible_fraction",
    "facing_known",
    "camera_fixed",
    "foot_velocity_correlation",
)


def frame_evidence(landmarks, width, height, profile=None):
    profile = profile or {}
    if len(landmarks) != 33 or width <= 0 or height <= 0:
        return None
    ids = (23, 24, 25, 26, 27, 28)
    if any(len(landmarks[i]) < 5 or not all(math.isfinite(v) for v in landmarks[i]) for i in ids):
        return None
    quality = min(min(landmarks[i][3:5]) for i in ids)
    if quality < 0.5:
        return None
    p = {i: (landmarks[i][0] * width, landmarks[i][1] * height) for i in ids}
    scale = mean(
        math.dist(p[h], p[k]) + math.dist(p[k], p[a]) for h, k, a in ((23, 25, 27), (24, 26, 28))
    )
    if scale < 10:
        return None
    hip = ((p[23][0] + p[24][0]) / 2, (p[23][1] + p[24][1]) / 2)
    facing = {"left": -1, "right": 1}.get(profile.get("facing"))
    values = dict(
        stance_width=abs(p[27][0] - p[28][0]) / scale,
        hip_height=((p[27][1] + p[28][1]) / 2 - hip[1]) / scale,
        left_knee=joint_angle(p[23], p[25], p[27]),
        right_knee=joint_angle(p[24], p[26], p[28]),
    )
    if values["left_knee"] is None or values["right_knee"] is None:
        return None
    for side, ankle in (("left", 27), ("right", 28)):
        values[f"{side}_foot_x"] = (p[ankle][0] - hip[0]) / scale
        values[f"{side}_foot_height"] = (hip[1] - p[ankle][1]) / scale
        values[f"{side}_foot_forward"] = values[f"{side}_foot_x"] * facing if facing else None
    return dict(
        version=VERSION,
        values=values,
        hip_pixels=hip,
        leg_pixels=scale,
        quality=quality,
        facing=facing,
        camera_fixed=profile.get("camera_motion") == "fixed",
    )


def enrich_frames(frames, width, height, profile=None):
    for frame in frames:
        frame["footwork"] = frame_evidence(frame.get("landmarks", []), width, height, profile)
    return frames


def temporal_vector(frames, start, end):
    selected = [f for f in frames if start <= f["time_ms"] <= end]
    valid = [f for f in selected if f.get("footwork") and f["footwork"].get("version") == VERSION]
    if len(valid) < 4 or len(valid) / max(1, len(selected)) < 0.7:
        return None
    times = np.asarray([f["time_ms"] for f in valid], dtype=float) / 1000
    if (
        times[0] * 1000 - start > 150
        or end - times[-1] * 1000 > 150
        or np.any(np.diff(times) <= 0)
        or np.any(np.diff(times) > 0.25)
    ):
        return None
    rows = [f["footwork"] for f in valid]
    scale = median(r["leg_pixels"] for r in rows)
    # Abrupt zoom/identity changes invalidate a temporal window.
    if max(r["leg_pixels"] for r in rows) / min(r["leg_pixels"] for r in rows) > 1.6:
        return None
    fixed = all(r["camera_fixed"] for r in rows)
    facing = rows[0]["facing"] if all(r["facing"] == rows[0]["facing"] for r in rows) else None
    vector, speeds = [], {}
    for key in CHANNELS:
        if key in {"hip_travel", "hip_vertical"}:
            axis = 0 if key == "hip_travel" else 1
            sign = facing if axis == 0 else -1
            values = (
                [(r["hip_pixels"][axis] - rows[0]["hip_pixels"][axis]) / scale * sign for r in rows]
                if fixed and sign
                else [None] * len(rows)
            )
        else:
            values = [r["values"][key] for r in rows]
        usable = [i for i, v in enumerate(values) if v is not None and math.isfinite(v)]
        coverage = len(usable) / len(values)
        if coverage < 0.7:
            vector.extend([0.0] * (len(STATS) - 1) + [coverage])
            continue
        arr = np.asarray([values[i] for i in usable], dtype=float)
        velocity = np.diff(arr) / np.diff(times[usable])
        speeds[key] = velocity
        vector.extend(
            [
                float(np.mean(arr)),
                float(np.std(arr)),
                float(np.min(arr)),
                float(np.max(arr)),
                float(arr[-1] - arr[0]),
                float(np.mean(velocity)),
                float(np.std(velocity)),
                float(np.max(np.abs(velocity))),
                coverage,
            ]
        )
    left, right = speeds.get("left_foot_x"), speeds.get("right_foot_x")
    correlation = (
        float(np.corrcoef(left, right)[0, 1])
        if left is not None
        and right is not None
        and len(left) == len(right)
        and np.std(left) > 1e-6
        and np.std(right) > 1e-6
        else 0.0
    )
    vector.extend(
        [len(valid) / len(selected), float(facing is not None), float(fixed), correlation]
    )
    return vector if all(math.isfinite(v) for v in vector) else None


def movement_summary(frames):
    """Describe pose motion and repeated vertical oscillations, without gesture claims."""
    valid = [f for f in frames if f.get("footwork")]
    runs, run = [], []
    for f in frames:
        if not f.get("footwork") or (run and f["time_ms"] - run[-1]["time_ms"] > 250):
            if run:
                runs.append(run)
            run = []
        if f.get("footwork"):
            run.append(f)
    if run:
        runs.append(run)
    rhythms = []
    for run in runs:
        if len(run) < 12 or run[-1]["time_ms"] - run[0]["time_ms"] < 2000:
            continue
        t = np.asarray([f["time_ms"] for f in run]) / 1000
        values = np.asarray([f["footwork"]["values"]["hip_height"] for f in run])
        # Smooth three observations. Peaks describe posture oscillation, not ground contact.
        smooth = np.convolve(values, np.ones(3) / 3, mode="valid")
        times = t[1:-1]
        peaks = []
        for i in range(1, len(smooth) - 1):
            if smooth[i] <= smooth[i - 1] or smooth[i] < smooth[i + 1]:
                continue
            lo, hi = max(0, i - 3), min(len(smooth), i + 4)
            if smooth[i] - max(min(smooth[lo : i + 1]), min(smooth[i:hi])) < 0.015:
                continue
            if peaks and times[i] - peaks[-1] < 0.25:
                continue
            peaks.append(float(times[i]))
        if len(peaks) < 4:
            continue
        intervals = np.diff(peaks)
        cv = float(np.std(intervals) / np.mean(intervals))
        if cv > 0.35:
            continue
        rhythms.append(
            dict(
                start_ms=round(peaks[0] * 1000),
                end_ms=round(peaks[-1] * 1000),
                cycles=len(intervals),
                cycles_per_minute=round(60 / float(np.mean(intervals)), 1),
                interval_variation=round(cv, 3),
                source="unvalidated_pose_oscillation",
            )
        )
    return dict(
        version=VERSION,
        visible_frames=len(valid),
        sampled_frames=len(frames),
        visible_fraction=round(len(valid) / max(1, len(frames)), 3),
        stance_width_range=[
            round(min(f["footwork"]["values"]["stance_width"] for f in valid), 3),
            round(max(f["footwork"]["values"]["stance_width"] for f in valid), 3),
        ]
        if valid
        else None,
        rhythm_intervals=rhythms,
        note="Lower-body pose evidence. Rhythm describes hip-height oscillations; it is not a verified bounce count or foot-contact measurement.",
    )
