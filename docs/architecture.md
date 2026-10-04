# Architecture and mobile path

## Implemented boundaries

- `api.py`: HTTP endpoints, request validation, static browser delivery and controlled error responses.
- `repository.py`: SQLite sessions and report runs, with per-operation connections and foreign keys.
- `coach/graph.py`: evidence gathering, retrieval, agent tool routing, structured report formatting and citation validation.
- `rag/knowledge.py`: Markdown chunking with stable per-file chunk IDs, local BM25 and optional Bedrock embeddings.
- `web/`: browser client using native ES modules and the same API a future mobile client can use. `app.js` owns routing and events; `store.js` owns session and report state; `api-client.js` owns HTTP and downloads; `views.js` renders screens; `components.js` contains shared session, report and evidence components; `ui.js` supplies formatting and charts; `practice-library.js` contains drill content; `media.js` owns camera and IndexedDB clip handling. `theme.css` defines the light/dark red palettes and fonts; `design-system.css` defines reusable components and responsive layouts; `styles.css` is the app's stylesheet entry point. The separate prototype gallery remains an archived design reference.
- `video_api.py`, `video_jobs.py`, `video_pipeline.py`: bounded upload, durable local queue, supervised pose extraction, browser preview, recovery proposals and reviewed measurement provenance. See [video pipeline](video-pipeline.md).
- `evaluation.py`: repeatable retrieval measurement over authored relevance labels.

Every run is persisted with the question, sources, model, retrieval method, activity trace, latency, token usage and report. Token counts are what the provider exposes, not cost estimates. Source ID validation checks provenance membership; it does not validate the reasoning or expertise of a coaching claim. Failed generation is not saved as a successful run.

Reports optionally accept `focus_metric_id`. It must belong to the session and is passed to evidence gathering, report formatting and saved run metadata. Demo output places that measurement first; live prompts ask for one supported next practice focus. Existing clients and historical JSON remain compatible because the field is optional.

## Training interface and media

The navigation is Train, Review, Record, Progress and Coach. Drill discovery and setup use the Piste visual language, while Review and Coach use Replay Studio's darker surfaces. Red is the primary accent in both; completion uses green. The journal provides a calmer progress section without switching the core navigation or duplicating functionality.

Camera recording uses browser media APIs with audio disabled, an explicit enable action and a two-minute limit. Drafts remain in memory. Analyze uploads a clip to the local server and creates a durable job; unprocessed attachments still use IndexedDB. Real pose landmarks and proposed recovery timings require review before becoming metrics. The existing coaching graph receives approved metrics and provenance rather than raw footage. `web/video.js` and `video.css` provide analysis progress, overlays, editable intervals and job history. Cross-device synchronization is not implemented.

Progress excludes built-in demo sessions and computes session counts and calendar days from session creation timestamps in the viewer's local timezone. Trends group exact metric names and units and compute a mean per session; camera comparability remains a user judgment. The sessions endpoint currently limits history to the latest 200 entries.

Knowledge IDs stay stable while a file's chunk boundaries stay stable. Historical runs store the actual retrieved text, so editing a knowledge file does not rewrite old reports. More robust content-hash/version IDs can be added before a larger production corpus.

## Deployment path

1. Deploy one container to a cloud runtime with HTTPS. Keep model calls on the server. Set runtime permissions for model access.
2. Replace local SQLite with a managed database or persistent-volume strategy suitable for the chosen runtime. A container filesystem is not permanent cloud storage, and local SQLite is not designed for replicated application instances.
3. Add account authentication and enforce session ownership at every API endpoint. Store raw videos in private object storage with short-lived upload/download URLs.
4. Replace the local video supervisor with a cloud queue and worker pool. The existing job/status/result/review API can remain; keep large media outside the coaching request.
5. Add per-user quotas, bounded upload limits, observed model costs, and monitoring before wider release.

## Phone app path

The existing UI already adapts to a narrow phone-sized browser. After HTTPS hosting, a web manifest, app icons and service worker can make it installable as a progressive web app. Offline reports may be possible; live AI and server video analysis need connectivity. Those installability features are not in this build.

A native iOS/Android interface can reuse session creation, report generation, history and export endpoints. Native camera capture and signed video upload are the main new client capabilities. API versioning and a generated typed client would help before maintaining two interfaces. Native packaging and App Store publication are separate work; the LangGraph and RAG backend can remain in Python.

## Validation performed during the first build

The local backend suite exercises the real graph in demo mode and fake live models for tool-loop limits and invalid citations. It does not verify an actual Bedrock model. Browser checks cover loading a demo and generating a cited report. Docker Desktop's daemon was unavailable locally; CI contains a container build and smoke check.
