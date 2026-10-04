# Core app implementation — 0.5

Authentication remains the final product stage. The local app is a single-athlete workspace.

## Implemented flows

1. Record silently with browser camera APIs or upload a clip (2 minutes / 200 MB).
2. Draft clips persist in IndexedDB across reloads. Analyze uploads a draft to the server.
3. A durable queue leases the clip to an independent, supervised pose worker. Multiple workers
   claim different jobs; heartbeats prevent another live worker’s job from being reclaimed.
4. Pose sampling and smooth video encoding run separately. The review includes landmark overlays,
   knee/arm/torso charts, recovery proposals, and editable onset/peak/return timestamps.
5. Save visible measurements even if no complete lunge/recovery is proposed. Each accepted interval
   includes recovery timing, knee and elbow angles at peak, torso tilt, normalized hip recovery speed,
   and arm-extension ratios at the chosen movement onset when the necessary landmarks are visible.
6. Specify weapon arm, front leg, screen-facing direction and whether the first 1.5 seconds show
   stationary guard. Confirmed initial guard gets a separate measurement summary. Footwork
   translations near the stance baseline are proposals, not validated gesture classifications.
7. Ask the local or cloud LLM a question. A LangGraph workflow retrieves notes, offers tools for
   metrics/baselines/journal/previous reviews/historical measurements, creates a required structured
   report, and validates its references. Invalid output gets one repair attempt, then fails visibly.
8. Coaching requests are queued with persistent status and stage updates. Reload reconnects to a
   pending request. Saved reviews provide context for follow-up questions.
9. Save a recommended drill to the training library and log its practice. Daily logs support date,
   minutes, effort, focus, notes and a linked video review; they can be edited or deleted. Progress
   uses practice dates and avoids counting the linked video review twice.

## Model training

Pose extraction uses the pinned pretrained MediaPipe model. A fencing gesture classifier has **not**
been trained from the one public demo. The review screen supports human labels for en garde,
advance, retreat, lunge, recovery and other, with labeled pose exports.

`scripts/train_gestures.py` trains a temporal logistic-regression classifier from labeled one-second
windows. It requires at least two classes, twenty usable windows per class and three independent
source videos per class. Duplicate source bytes remain in the same split. Re-encoded copies of one
recording must not be supplied as independent videos. The trainer exports JSON weights and a model
card, including source licenses, per-class results and the held-out video hashes. It does not load
pickled models. `--promote` requires held-out macro F1 >= 0.75; otherwise the existing active model
is preserved. This threshold is a development gate, not a claim of general accuracy.

```powershell
.\.venv\Scripts\python.exe scripts/train_gestures.py --data data/videos --output models/gestures.json
# After reviewing the candidate’s held-out results and data quality:
.\.venv\Scripts\python.exe scripts/train_gestures.py --data data/videos --output models/gestures.json --promote
```

A promoted model adds reviewable, timestamped gesture predictions to future analyses. Missing pose
features cause abstention. Scores are uncalibrated; expert annotations and independent recordings
are still needed to establish generalization.

## Scaling and storage

Local development uses SQLite and one embedded worker per service. PostgreSQL is supported through
`FENCECOACH_DATABASE_URL`; short queue transactions use an advisory lock for claim/update integrity.
API replicas and `python -m fencecoach.worker` processes can run independently.

The Docker Compose stack contains PostgreSQL, an API, a separate worker and Ollama. Local Docker
volumes share video artifacts on one Docker host. For workers on separate machines, use an existing
private S3 bucket with standard AWS credentials. Sources are uploaded before queueing; workers
download sources into local caches and publish versioned analysis artifacts. The database stores the
active artifact version, so stale attempts do not replace an accepted result. The API serves cached
artifacts with range support. Labels are stored in the job record and exported with source credits.
No bucket or cloud account is created automatically.

```powershell
# Install the pose model on the host first; models is mounted read-only.
.\.venv\Scripts\python.exe scripts/setup_video.py
# Set FENCECOACH_POSTGRES_PASSWORD in .env to a URL-safe secret, then:
docker compose up --build -d
docker compose exec ollama ollama pull qwen3:4b
docker compose up -d --scale worker=3
```

Cloud deployment and throughput/load evaluation have not been performed. Ollama throughput is
bounded by the model hardware; use a configured cloud model or adequate inference hardware for
larger workloads. PostgreSQL/S3 support and worker replicas are deployment building blocks, not an
established production capacity claim. Authentication, per-user isolation, quotas, retention and
public deployment remain subsequent work. The Compose API port stays bound to localhost.

## Measurement limits

Angles are image-plane estimates. Torso tilt cannot establish spinal straightness. Wrist landmarks
cannot locate the blade or check weapon contact. Recovery speed uses torso lengths per second,
not metres per second. Movement onset is a reviewed kinematic marker, not tactical attack intent.
Visibility/presence is a tracking-quality proxy, not a calibrated accuracy probability. Fencing is
asymmetric; equal left/right knee angles or arm extension are not a universal goal.

The public MIT clip retains its attribution and CC BY-NC-SA 3.0 license. It is development/demo
material and does not count toward the athlete’s practice goal.
