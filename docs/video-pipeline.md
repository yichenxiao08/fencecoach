# Local video pipeline

## Setup

From the repository folder, with the base app installed:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-video.lock
.\.venv\Scripts\python.exe scripts/setup_video.py --demo
.\.venv\Scripts\python.exe -m uvicorn fencecoach.api:app --host 127.0.0.1 --port 8000
```

Alternatively use `pip install -e '.[video]'`. Setup downloads two fixed URLs with SHA-256 checks. Weights and footage stay out of Git. Open **Record → Analyze public fencing demo**, or upload a clip and select **Analyze this clip**. Watch, edit, remove or manually add recovery intervals, then **Save reviewed practice** to send those metrics into the existing LangGraph/RAG workflow. Uploading alone does not create a practice session.

Optional Docker setup, after preparing model/demo assets on the host:

```powershell
docker compose -f compose.yaml -f compose.video.yaml up --build
```

The optional image adds native video dependencies. Model and demo mounts are read-only; uploads/results use the data volume. This optional image has not been built locally because the Docker daemon was unavailable.

## Processing and storage

```text
MP4 / WebM → SQLite queue → supervised child → upright preview + timestamped pose
                                                        |
                                 recovery proposals → human review → metrics
                                                                      |
                                                               LangGraph + RAG
```

One supervisor runs one child at a time, outside the HTTP request. SQLite retains progress and errors. Interrupted jobs become failures after restart; failed jobs can be retried. Review acceptance writes the session and completed job in one transaction and is idempotent. **Use one API process**, without Uvicorn `--workers`, and one FenceCoach instance per database. This is a local queue, not distributed scheduling.

Bounds: 200 MiB, 120 seconds, at most 4K resolution; five outstanding jobs; ten-minute worker timeout and decoded-frame cap. Multipart bytes are bounded as they arrive, including chunked requests. Storage uses generated IDs rather than user filenames; no arbitrary remote URL endpoint exists.

Each `data/videos/{job_id}/` contains `source.video`, `preview.mp4`, `poster.jpg` and `result.json`. Previews are upright, resized to at most 960 pixels on the longer side and silent. Playback preserves source timestamps and cadence up to 30 fps independently of the 12 fps pose analysis. Low-rate source footage stays low-rate; no video frames are invented. MP4 indexing is at the start of the file, with no B frames, keyframes about once a second and a first-frame poster. Published files are replaced only after encoding finishes, and revision URLs avoid stale previews. Pose extraction uses an optional crop, resized to at most 960 pixels on its longer side before inference and mapped back into full-frame coordinates. New results include preview metadata, preprocessing dimensions and actual processing durations. Crop percentages describe the upright frame and must contain one athlete's entire movement.

Original uploads and landmarks remain on the local server, without automatic deletion. Keep this unauthenticated app on localhost. Cloud use needs authentication, ownership checks, retention controls and private storage. Extraction makes no LLM calls and does not send footage to Bedrock. Live coaching sends derived metrics and notes through the configured provider.

## Evidence semantics

- Decoded PTS/time-base values define timestamps. Missing/backward timestamps fail the job. Rotation is normalized. Pose sampling targets approximately 12 fps; actual timestamps are retained. Playback sampling is independent.
- Frames with multiple poses or large sudden hip-position jumps are excluded. This cannot guarantee identity continuity through occlusion; use solo footage or a crop.
- `stance_ratio` is horizontal ankle separation divided by mean shoulder-to-hip length in image pixels. Knee angles are 2D debug features. No physical-distance, contact, balance or technique score is produced.
- `stance-return-v1` assumes the first 1.5 seconds contain en garde. Expansion must exceed both 1.3 × median initial stance and that median + 0.3. Return means being within median + 0.2 for at least 333 ms. Proposed peak-to-return intervals range from 250 ms to six seconds. These are engineering thresholds, not validated fencing standards.
- Missing/ambiguous/low-quality frames and gaps over 300 ms interrupt proposals. Partial actions are not completed automatically. Jumps, resets and turns can produce false proposals.
- Quality averages each frame's minimum hip/knee/ankle visibility and presence. It is **not calibrated accuracy**, event confidence or technique correctness. Manually added/edited intervals have no automatic quality estimate; the existing confidence field is zero with explicit provenance.
- Saving requires review. Metrics retain job ID, method version, model SHA, timestamps and annotation type. User review is not expert ground truth.

## Public demo

**Jump Lunge / Individual**, MIT OpenCourseWare, *PE.740 Fencing, Spring 2007*, instructor Prof. Jaroslav Koniusz. [Course index](https://ocw.mit.edu/courses/pe-740-fencing-spring-2007/pages/video/), [original MP4](https://archive.org/download/MITPE.740S06/jumpe_lunge-220k_512kb.mp4), [Archive metadata](https://archive.org/metadata/MITPE.740S06).

Archive metadata names MIT OpenCourseWare as creator and links [CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/). The local preview changes size, sampling and audio. Retain attribution and license for adapted media. This noncommercial development example is fetched separately and is excluded from the user's practice goals. Application code and third-party media have separate licenses.

After correcting sampling cadence, the MIT clip produced 91 sampled frames, 89 usable feature frames, one ambiguous frame and two recovery proposals. **These are execution counts, not accuracy or recall measurements.** Independent labels are needed to distinguish a lunge recovery from a jump, reset or turn.

Next: build a small attributed/labeled set with explicit peak and recovery definitions; measure event precision/recall, timing MAE, usable-frame rate and processing latency. Extend camera angles/actions and move to a cloud queue after measuring those limitations.

References: [MediaPipe Python](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/python), [model overview](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker), [PyAV timing](https://pyav.org/docs/stable/api/time.html), [FastAPI uploads](https://fastapi.tiangolo.com/tutorial/request-files/).


## Playback improvements

The overlay uses the displayed frame's media timestamp through `requestVideoFrameCallback` where supported. It no longer repaints at display refresh rate while paused. Older browsers animate only during playback. Canvas resolution is bounded to the preview dimensions. Linear display interpolation is limited to adjacent valid poses within 200 ms and without a large hip-position discontinuity; it never changes stored landmarks, features or timings, nor fills missing or ambiguous pose samples.

To upgrade an existing analysis's playback assets without recomputing its evidence, run `python -m fencecoach.video_preview --job YOUR_JOB_ID` from the repository directory against a review-ready or completed job, then reload the browser. Source cadence limitations still apply.

Implementation references: [video frame callbacks](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback) and [FFmpeg encoder options](https://ffmpeg.org/ffmpeg-codecs.html#libx264_002c-libx264rgb).
