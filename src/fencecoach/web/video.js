import { api, downloadJSON } from "./api-client.js";
import { e, icon, heading, primary, secondary } from "./ui.js";
import { refreshSessions } from "./store.js";

const videoPath = (id) => `/api/videos/${encodeURIComponent(id)}`;
let controls,
  pollTimer,
  jobEpoch = 0;
export function analysis(state) {
  const job = state.videoJob,
    result = state.videoResult;
  if (!job)
    return `${heading("MOVEMENT ANALYSIS", "Bring your practice.<br>See your return.")}<div class="empty-session"><p>Start with a short side-view clip or MIT’s public fencing demonstration.</p>${primary("Choose a clip", 'data-go="record"')}${secondary("Analyze public demo", "data-video-demo")}</div>`;
  if (!result)
    return `${heading("MOVEMENT ANALYSIS", "One rep at a time.")}<section class="analysis-status side-card"><p class="eyebrow">${e(job.title)}</p><h2 id="analysis-stage">${e(job.stage)}</h2><progress id="analysis-progress" max="100" value="${job.progress}"></progress><p id="analysis-detail" role="status">${job.status === "failed" ? e(job.error) : `${job.progress}% · You can leave this screen while analysis runs.`}</p>${job.status === "failed" ? secondary("Retry analysis", "data-video-retry") : '<span class="spinner"></span>'}${secondary("Back to practice", 'data-go="record"')}</section>`;
  const finished = job.status === "completed";
  return `${heading("MOVEMENT REVIEW", "See your return.<br>Make it yours.")}<div class="analysis-topline"><span>${e(job.title)}</span><span>${job.source === "mit_ocw" ? "PUBLIC DEMONSTRATION" : "YOUR FOOTAGE"}</span></div><div class="analysis-layout"><section><div class="analysis-player"><video id="analysis-video" src="${videoPath(job.job_id)}/preview" controls playsinline preload="metadata"></video><canvas id="analysis-overlay" aria-hidden="true"></canvas></div><div class="analysis-tools"><button class="secondary-action" data-video-overlay aria-pressed="${state.videoOverlay}">${icon("target")}Landmarks ${state.videoOverlay ? "on" : "off"}</button><span>${result.tracked_frames} / ${result.sampled_frames} frames usable</span></div><p class="helper">The red overlay comes from this footage. Missing or ambiguous poses stay unmarked.</p>${job.source === "mit_ocw" ? `<p class="video-credit">${e(result.source_credit)}. <a href="https://ocw.mit.edu/courses/pe-740-fencing-spring-2007/pages/video/" target="_blank" rel="noreferrer">Source</a> · <a href="https://creativecommons.org/licenses/by-nc-sa/3.0/" target="_blank" rel="noreferrer">CC BY-NC-SA 3.0</a>. Preview is resized, sampled and silent. This demo doesn’t count toward your practice goal.</p>` : '<p class="helper">Uploaded video and analysis are saved on your local FenceCoach server. This step makes no LLM calls.</p>'}<details class="disclosure"><summary>How these timings were proposed ${icon("chevron")}</summary><ul>${result.warnings.map((w) => `<li>${e(w)}</li>`).join("")}</ul><p>We compare ankle separation relative to torso length with the first 1.5 seconds of guard. The interval begins at peak stance and ends when stance returns to the initial band for at least 333 ms. It does not measure weapon contact, balance or technique quality.</p><button class="text-action" data-video-export>Export landmarks & analysis ${icon("arrow")}</button></details></section><aside class="analysis-review side-card"><p class="eyebrow">${finished ? "SAVED REVIEW" : "YOUR EYES COME FIRST"}</p><h2>${finished ? "Ready for the coach." : "Review each recovery."}</h2><p>${finished ? "Your approved timings are attached to the session." : "Watch each interval. Adjust the peak and return, or remove a proposal that doesn’t match the movement."}</p><div id="window-list">${state.videoWindows.map((w, i) => windowRow(w, i, result.duration_ms, finished)).join("") || '<p class="empty-note">No complete recovery was proposed. You can mark an interval yourself.</p>'}</div>${finished ? primary("Open saved session", `data-session="${e(job.session_id)}"`) : `${secondary("Add a manual interval", "data-window-add")}<label class="field"><span>Practice note</span><textarea id="video-notes" maxlength="2000" rows="2" placeholder="One thing you noticed…"></textarea></label><button class="primary-action" data-video-accept ${!state.videoWindows.length ? "disabled" : ""}>Save reviewed practice ${icon("arrow")}</button>`}<p class="subtle-note">A shorter return alone doesn’t establish better technique. Manually edited intervals have no automatic tracking-quality estimate.</p></aside></div>`;
}
function windowRow(window, i, duration, finished) {
  return `<div class="recovery-window" data-window-row="${i}"><div class="window-heading"><strong>RETURN ${String(i + 1).padStart(2, "0")}</strong><button class="text-action" data-window-seek="${i}">Watch ${icon("play")}</button></div><div class="form-row"><label class="field"><span>Peak / seconds</span><input type="number" min="0" max="${duration / 1000}" step="0.001" value="${window.start_ms / 1000}" data-window-field="start_ms" data-window-index="${i}" ${finished ? "disabled" : ""}></label><label class="field"><span>Return / seconds</span><input type="number" min="0" max="${duration / 1000}" step="0.001" value="${window.end_ms / 1000}" data-window-field="end_ms" data-window-index="${i}" ${finished ? "disabled" : ""}></label></div><div class="window-footer"><span id="window-duration-${i}">${((window.end_ms - window.start_ms) / 1000).toFixed(3)} s</span>${finished ? "" : `<button class="text-action" data-window-remove="${i}" aria-label="Remove recovery ${i + 1}">Remove ${icon("close")}</button>`}</div>${finished ? "" : `<div class="window-marks"><button data-window-mark="start_ms" data-window-index="${i}">Use playhead for peak</button><button data-window-mark="end_ms" data-window-index="${i}">Use playhead for return</button></div>`}</div>`;
}
export function videoSetup(state) {
  return `<div class="video-setup"><label class="field"><span>Session name</span><input id="video-title" maxlength="100" value="Lunge & recovery practice"></label><details class="disclosure"><summary>Keep one athlete in view ${icon("chevron")}</summary><p>For a solo clip, use the whole frame. For a busy scene, crop the upright preview to one fencer’s entire movement. Values are percentages of the frame.</p><div class="crop-fields">${[
    ["x", "Left", 0],
    ["y", "Top", 0],
    ["width", "Width", 100],
    ["height", "Height", 100],
  ]
    .map(
      ([key, name, value]) =>
        `<label class="field"><span>${name} %</span><input id="crop-${key}" type="number" min="0" max="100" value="${value}"></label>`,
    )
    .join(
      "",
    )}</div></details>${primary("Analyze this clip", "data-video-upload")}</div>`;
}
export function videoHistory(state) {
  return state.videoJobs.length
    ? `<section class="video-history"><div class="section-heading"><h2>Movement analyses</h2></div><div class="practice-log">${state.videoJobs
        .slice(0, 5)
        .map(
          (j) =>
            `<button data-video-job="${e(j.job_id)}"><span class="log-icon">${icon("play")}</span><div><strong>${e(j.title)}</strong><small>${e(j.stage)}${j.source === "mit_ocw" ? " · Public demo" : ""}</small></div>${icon("chevron")}</button>`,
        )
        .join("")}</div></section>`
    : "";
}
export function setupVideoController(options) {
  controls = options;
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button || button.disabled) return;
    const { state, render, go, notice } = controls;
    try {
      if (button.hasAttribute("data-video-demo")) {
        button.disabled = true;
        await openJob(await api("/api/videos/demo", { method: "POST" }));
        go("analysis");
      } else if (button.hasAttribute("data-video-upload")) {
        if (!state.draftClip) return;
        const data = new FormData(),
          crop = {};
        for (const key of ["x", "y", "width", "height"])
          crop[key] =
            Number(document.getElementById(`crop-${key}`).value) / 100;
        if (
          crop.width <= 0.1 ||
          crop.height <= 0.1 ||
          crop.x + crop.width > 1 ||
          crop.y + crop.height > 1
        )
          throw new Error(
            "Choose a crop inside the frame, at least 10% wide and high.",
          );
        data.append("file", state.draftClip, "practice.video");
        data.append(
          "title",
          document.getElementById("video-title").value.trim() ||
            "Lunge practice",
        );
        data.append("skill_level", state.preferences.skill);
        data.append("crop", JSON.stringify(crop));
        button.disabled = true;
        const job = await upload(data, (percent) => {
          button.textContent = `Uploading ${percent}%`;
        });
        await openJob(job);
        controls.setDraft(null);
        go("analysis");
      } else if (button.dataset.videoJob) {
        await openJob(await api(videoPath(button.dataset.videoJob)));
        go("analysis");
      } else if (button.hasAttribute("data-video-retry")) {
        button.disabled = true;
        await openJob(
          await api(`${videoPath(state.videoJob.job_id)}/retry`, {
            method: "POST",
          }),
        );
        render({ keepScroll: true });
      } else if (button.hasAttribute("data-video-overlay")) {
        state.videoOverlay = !state.videoOverlay;
        button.setAttribute("aria-pressed", state.videoOverlay);
        button.innerHTML = `${icon("target")}Landmarks ${state.videoOverlay ? "on" : "off"}`;
      } else if (button.hasAttribute("data-video-export")) {
        downloadJSON(
          state.videoResult,
          `analysis-${state.videoJob.job_id}.json`,
        );
      } else if (button.hasAttribute("data-window-seek")) {
        const video = document.getElementById("analysis-video"),
          w = state.videoWindows[Number(button.dataset.windowSeek)];
        video.currentTime = w.start_ms / 1000;
        video.ontimeupdate = () => {
          if (video.currentTime >= w.end_ms / 1000) {
            video.pause();
            video.ontimeupdate = null;
          }
        };
        video.play().catch(() => {});
      } else if (button.hasAttribute("data-window-add")) {
        state.videoWindows.push({
          start_ms: 0,
          end_ms: Math.min(1000, state.videoResult.duration_ms),
          candidate_id: null,
        });
        redrawWindows();
      } else if (button.hasAttribute("data-window-remove")) {
        state.videoWindows.splice(Number(button.dataset.windowRemove), 1);
        redrawWindows();
      } else if (button.dataset.windowMark) {
        const i = Number(button.dataset.windowIndex),
          key = button.dataset.windowMark;
        const value = Math.round(
          document.getElementById("analysis-video").currentTime * 1000,
        );
        state.videoWindows[i][key] = value;
        document.querySelector(
          `[data-window-index="${i}"][data-window-field="${key}"]`,
        ).value = value / 1000;
        updateDuration(i);
      } else if (button.hasAttribute("data-video-accept")) {
        button.disabled = true;
        const session = await api(
          `${videoPath(state.videoJob.job_id)}/accept`,
          {
            method: "POST",
            body: JSON.stringify({
              windows: state.videoWindows,
              notes: document.getElementById("video-notes").value,
            }),
          },
        );
        await refreshSessions();
        state.videoJob = await api(videoPath(state.videoJob.job_id));
        state.videoJobs = await api("/api/videos");
        await controls.select(session.session_id);
        go("review");
      }
    } catch (error) {
      notice(error.message);
    } finally {
      if (button.isConnected) {
        button.disabled = false;
        if (button.hasAttribute("data-video-upload"))
          button.innerHTML = `Analyze this clip ${icon("arrow")}`;
      }
    }
  });
  document.addEventListener("input", (event) => {
    const target = event.target;
    if (!target.dataset.windowField) return;
    const i = Number(target.dataset.windowIndex);
    controls.state.videoWindows[i][target.dataset.windowField] = Math.round(
      Number(target.value) * 1000,
    );
    updateDuration(i);
  });
}
function updateDuration(i) {
  const w = controls.state.videoWindows[i];
  document.getElementById(`window-duration-${i}`).textContent =
    `${((w.end_ms - w.start_ms) / 1000).toFixed(3)} s`;
}
function redrawWindows() {
  const { state } = controls;
  document.getElementById("window-list").innerHTML = state.videoWindows
    .map((w, i) => windowRow(w, i, state.videoResult.duration_ms, false))
    .join("");
  document.querySelector("[data-video-accept]").disabled =
    !state.videoWindows.length;
}
async function openJob(job) {
  const ticket = ++jobEpoch,
    { state } = controls;
  clearTimeout(pollTimer);
  state.videoJob = job;
  state.videoResult = null;
  try {
    localStorage.setItem("fencecoach.videoJob", job.job_id);
  } catch {
    /* Optional browser storage. */
  }
  if (["review_ready", "completed"].includes(job.status)) {
    const result = await api(`${videoPath(job.job_id)}/result`);
    if (ticket !== jobEpoch) return;
    state.videoResult = result;
    state.videoWindows = (job.reviewed_windows || result.candidates).map(
      (w) => ({
        start_ms: w.start_ms,
        end_ms: w.end_ms,
        candidate_id: w.candidate_id,
      }),
    );
  } else if (["queued", "running", "receiving"].includes(job.status))
    pollTimer = setTimeout(() => pollJob(ticket), 1500);
  state.videoJobs = await api("/api/videos");
}
async function pollJob(ticket) {
  if (ticket !== jobEpoch) return;
  const { state, render, notice } = controls;
  try {
    const job = await api(videoPath(state.videoJob.job_id));
    if (ticket !== jobEpoch) return;
    state.videoJob = job;
    if (["review_ready", "completed", "failed"].includes(job.status)) {
      await openJob(job);
      if (["analysis", "record"].includes(state.screen))
        render({ keepScroll: true });
    } else {
      const progress = document.getElementById("analysis-progress"),
        stage = document.getElementById("analysis-stage"),
        detail = document.getElementById("analysis-detail");
      if (progress) progress.value = job.progress;
      if (stage) stage.textContent = job.stage;
      if (detail)
        detail.textContent = `${job.progress}% · ${job.sampled_frames || 0} frames sampled. You can leave this screen.`;
      pollTimer = setTimeout(() => pollJob(ticket), 1500);
    }
  } catch (error) {
    notice(`${error.message} Reconnecting to the video worker…`);
    pollTimer = setTimeout(() => pollJob(ticket), 5000);
  }
}
export async function initVideo() {
  const { state } = controls;
  state.videoJobs = await api("/api/videos");
  let id;
  try {
    id = localStorage.getItem("fencecoach.videoJob");
  } catch {
    /* Optional storage. */
  }
  const job =
    state.videoJobs.find((j) => j.job_id === id) || state.videoJobs[0];
  if (job) await openJob(job);
}
export async function loadReviewPose(state) {
  state.reviewResult = state.session?.video_job_id
    ? await api(`${videoPath(state.session.video_job_id)}/result`)
    : null;
}
function upload(data, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/videos");
    xhr.timeout = 180000;
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable)
        onProgress(Math.round((100 * ev.loaded) / ev.total));
    };
    xhr.onload = () => {
      let response;
      try {
        response = JSON.parse(xhr.responseText);
      } catch {
        reject(new Error("The upload response was unreadable."));
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(response);
      else
        reject(
          new Error(
            typeof response.detail === "string"
              ? response.detail
              : "The video upload failed. Check the file and crop.",
          ),
        );
    };
    xhr.onerror = () =>
      reject(
        new Error(
          "Couldn’t reach the local server. Your draft is still available.",
        ),
      );
    xhr.ontimeout = () =>
      reject(new Error("Upload timed out. Try a shorter clip."));
    xhr.send(data);
  });
}
const edges = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
  [27, 29],
  [29, 31],
  [28, 30],
  [30, 32],
];
export function mountPose(video, canvas, result, state) {
  if (!video || !canvas || !result) return () => {};
  const context = canvas.getContext("2d");
  canvas.width = result.width;
  canvas.height = result.height;
  let handle,
    stopped = false;
  function draw() {
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (state.videoOverlay) {
      const t = video.currentTime * 1000;
      let lo = 0,
        hi = result.frames.length - 1;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (result.frames[mid].time_ms < t) lo = mid + 1;
        else hi = mid;
      }
      const choices = [result.frames[lo], result.frames[Math.max(0, lo - 1)]];
      const frame = choices.sort(
        (a, b) => Math.abs(a.time_ms - t) - Math.abs(b.time_ms - t),
      )[0];
      if (
        frame &&
        Math.abs(frame.time_ms - t) <= 120 &&
        frame.landmarks.length
      ) {
        context.strokeStyle = "#ff3746";
        context.fillStyle = "#fff";
        context.lineWidth = Math.max(1.5, result.width / 180);
        const point = (i) => [
          frame.landmarks[i][0] * canvas.width,
          frame.landmarks[i][1] * canvas.height,
        ];
        for (const [a, b] of edges)
          if (frame.landmarks[a][3] > 0.5 && frame.landmarks[b][3] > 0.5) {
            context.beginPath();
            context.moveTo(...point(a));
            context.lineTo(...point(b));
            context.stroke();
          }
        for (const i of new Set(edges.flat()))
          if (frame.landmarks[i][3] > 0.5) {
            context.beginPath();
            context.arc(
              ...point(i),
              Math.max(2, result.width / 130),
              0,
              Math.PI * 2,
            );
            context.fill();
          }
      }
    }
    if (!stopped) handle = requestAnimationFrame(draw);
  }
  draw();
  return () => {
    stopped = true;
    cancelAnimationFrame(handle);
  };
}
