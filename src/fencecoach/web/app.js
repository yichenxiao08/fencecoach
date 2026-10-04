import { $, e, icon, clock } from "./ui.js";
import { api, downloadJSON, downloadBlob } from "./api-client.js";
import {
  state,
  initStore,
  selectSession,
  loadSample,
  importSession,
  generateReport,
  savePreferences,
  restoreRunFocus,
} from "./store.js";
import { screens } from "./views.js";
import { setupVideoController, initVideo, mountPose } from "./video.js";
import { metricEvidence, selectedMetrics } from "./components.js";
import { findDrill } from "./practice-library.js";
import {
  capture,
  openCamera,
  mountCamera,
  startRecording,
  finishRecording,
  closeCamera,
  validateClip,
  saveClip,
  loadClip,
  setClip,
  getClipURL,
  getClip,
} from "./media.js";

const navigation = [
  ["train", "target", "Train"],
  ["review", "play", "Review"],
  ["record", "camera", "Record"],
  ["progress", "chart", "Progress"],
  ["coach", "chat", "Coach"],
];
let toastTimer,
  mediaEpoch = 0,
  draftURL = null,
  cameraEpoch = 0,
  finishPending = false;
let stopOverlay = () => {};
function notice(text = "") {
  state.error = text;
  $("notice").textContent = text;
  $("notice").hidden = !text;
}
function toast(text) {
  $("toast").textContent = text;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 3500);
}
function route() {
  const name = location.hash.slice(1).split("?")[0];
  return screens[name] ? name : "train";
}
function render({ keepScroll = false, focus = false } = {}) {
  const scroll = window.scrollY;
  const dark = ["review", "coach", "analysis"].includes(state.screen);
  document.body.className = dark ? "studio" : "piste";
  document.querySelector('meta[name="theme-color"]').content = dark
    ? "#0e121a"
    : "#faf9f6";
  const active =
    state.screen === "analysis"
      ? "review"
      : ["drill", "library"].includes(state.screen)
        ? "train"
        : state.screen;
  for (const id of ["desktop-nav", "mobile-nav"])
    $("" + id).innerHTML = navigation
      .map(
        ([name, symbol, title]) =>
          `<button data-go="${name}" class="${active === name ? "active" : ""} ${name === "record" ? "record-nav" : ""}" ${active === name ? 'aria-current="page"' : ""}>${icon(symbol)}<span>${title}</span></button>`,
      )
      .join("");
  document
    .querySelectorAll('button[data-go="settings"]')
    .forEach((button) =>
      button.setAttribute(
        "aria-current",
        state.screen === "settings" ? "page" : "false",
      ),
    );
  $("screen").className = `screen screen-${state.screen}`;
  $("screen").innerHTML = state.loading
    ? '<div class="loading-state"><span class="spinner"></span><h1>Getting your training space ready.</h1><p>Loading your saved sessions…</p></div>'
    : screens[state.screen](state);
  document.title = `FenceCoach · ${state.screen === "drill" ? findDrill(state.drillId).name : state.screen.charAt(0).toUpperCase() + state.screen.slice(1)}`;
  mountMedia();
  if (!keepScroll) window.scrollTo({ top: 0, behavior: "instant" });
  else window.scrollTo({ top: scroll, behavior: "instant" });
  if (focus) $("screen").focus({ preventScroll: true });
}
function mountMedia() {
  stopOverlay();
  if (state.screen === "analysis") {
    stopOverlay = mountPose(
      $("analysis-video"),
      $("analysis-overlay"),
      state.videoResult,
      state,
    );
  }
  if (state.screen === "record") {
    mountCamera($("camera-preview"));
    if ($("draft-preview") && draftURL) $("draft-preview").src = draftURL;
  }
  if (
    state.screen === "review" &&
    $("replay-video") &&
    (state.session?.video_job_id || getClipURL())
  ) {
    const video = $("replay-video");
    video.src = state.session.video_job_id
      ? `/api/videos/${encodeURIComponent(state.session.video_job_id)}/preview`
      : getClipURL();
    stopOverlay = mountPose(
      video,
      $("review-overlay"),
      state.reviewResult,
      state,
    );
    video.onloadedmetadata = () => {
      const metric = selectedMetrics(state).metric;
      if (metric?.start_ms != null && metric.start_ms / 1000 < video.duration)
        video.currentTime = metric.start_ms / 1000;
    };
    video.onerror = () =>
      notice(
        "This browser couldn’t play the attached video. Try an MP4 or WebM clip supported by your browser.",
      );
  }
}
function go(screen) {
  if (!screens[screen]) return;
  if (state.screen === "record" && capture.recording && screen !== "record") {
    toast("Finish your recording before leaving this practice.");
    return;
  }
  if (screen !== state.screen && state.screen === "record") {
    cameraEpoch++;
    closeCamera();
  }
  if (location.hash !== `#${screen}`) location.hash = screen;
  else {
    state.screen = screen;
    render({ focus: true });
  }
}
window.addEventListener("hashchange", () => {
  const next = route();
  if (capture.recording && next !== "record") {
    history.replaceState(null, "", "#record");
    toast("Finish your recording before leaving this practice.");
    return;
  }
  if (state.screen === "record" && next !== "record") {
    cameraEpoch++;
    closeCamera();
  }
  state.screen = next;
  render({ focus: true });
});
window.addEventListener("beforeunload", (event) => {
  if (capture.recording || state.draftClip) {
    event.preventDefault();
    event.returnValue = "";
  }
});
window.addEventListener("pagehide", () => closeCamera());

async function withBusy(action) {
  if (state.busy) return;
  state.busy = true;
  notice();
  document
    .querySelectorAll("[data-sample],[data-session],#session-picker")
    .forEach((button) => (button.disabled = true));
  try {
    await action();
  } catch (error) {
    notice(error.message);
  } finally {
    state.busy = false;
    document
      .querySelectorAll("[data-sample],[data-session],#session-picker")
      .forEach((button) => (button.disabled = false));
  }
}
async function select(id) {
  const success = await selectSession(id);
  if (!success) return;
  await sessionMedia(id);
}
async function sessionMedia(id) {
  const ticket = ++mediaEpoch;
  setClip(null);
  state.reviewResult = null;
  if (state.session?.video_job_id) {
    const session = state.session;
    const result = await api(
      `/api/videos/${encodeURIComponent(session.video_job_id)}/result`,
    );
    if (ticket === mediaEpoch && state.session?.session_id === id)
      state.reviewResult = result;
    return;
  }
  try {
    const clip = await loadClip(id);
    if (ticket === mediaEpoch && state.session?.session_id === id)
      setClip(clip);
  } catch (error) {
    if (ticket === mediaEpoch) toast(error.message);
  }
}
function setDraft(blob) {
  if (draftURL) URL.revokeObjectURL(draftURL);
  state.draftClip = blob;
  draftURL = blob ? URL.createObjectURL(blob) : null;
}
async function finish() {
  if (finishPending || !capture.recording) return;
  finishPending = true;
  try {
    const clip = await finishRecording();
    closeCamera();
    validateClip(clip);
    setDraft(clip);
    render({ keepScroll: true });
    toast("Practice recorded. Analyze your clip to review its movement.");
  } catch (error) {
    closeCamera();
    notice(error.message);
    render({ keepScroll: true });
  } finally {
    finishPending = false;
  }
}

function openImport() {
  const dialog = $("import-dialog");
  dialog.innerHTML = `<form id="import-form"><div class="dialog-heading"><div><p class="eyebrow">YOUR PRACTICE</p><h2 id="import-title">Bring in a session.</h2></div><button class="icon-button" type="button" data-close="import-dialog" aria-label="Close import">${icon("close")}</button></div><p class="helper">Import measured values from your analysis tool. ${state.draftClip ? "Your recorded clip will be saved with this session on this device." : "You can attach a video after importing."}</p><label class="file-field">${icon("upload")}<span>Choose a session JSON file</span><input id="json-file" type="file" accept=".json,application/json" /></label><label class="field"><span>Session name</span><input name="title" id="import-name" maxlength="100" value="${e(findDrill(state.drillId).name + " / practice")}" required /></label><div class="form-row"><label class="field"><span>Skill level</span><select name="skill" id="import-skill"><option value="beginner" ${state.preferences.skill === "beginner" ? "selected" : ""}>Beginner</option><option value="intermediate" ${state.preferences.skill === "intermediate" ? "selected" : ""}>Intermediate</option></select></label><label class="field"><span>Practice notes</span><input id="import-notes" name="notes" maxlength="2000" placeholder="One focus from today…" /></label></div><label class="field"><span>Measurement JSON</span><textarea id="session-json" rows="7" required spellcheck="false" placeholder='[{"metric_id":"rep-01-recovery","name":"recovery_time","value":920,"unit":"ms","confidence":0.88}]'></textarea></label><p class="helper">Paste a measurements array or a complete session object. Use your own values and source confidence. Optional: baseline_value, start_ms, end_ms.</p><a class="text-action" href="/static/sample-session.json" download="sample-session.json">Download a synthetic format example ${icon("arrow")}</a><p class="form-error" id="import-error" role="alert"></p><button class="primary-action" id="save-session" type="submit">Save practice session ${icon("arrow")}</button></form>`;
  dialog.showModal();
}
function showEvidence(type, id) {
  let body;
  if (type === "metric") {
    const metric = state.session?.metrics.find((m) => m.metric_id === id);
    if (!metric) return;
    body = metricEvidence(metric, state.session.is_demo);
  } else {
    const source = state.run?.sources.find((s) => s.source_id === id);
    if (!source) return;
    body = `<p class="eyebrow">RETRIEVED PRACTICE NOTE</p><h3>${e(source.source)}</h3><p class="source-text">${e(source.text)}</p><code>${e(source.source_id)}</code><p class="helper">Authored development notes. Review technique guidance with your fencing coach.</p>`;
  }
  const dialog = $("evidence-dialog");
  dialog.innerHTML = `<div class="dialog-heading"><h2 id="evidence-title">Behind the cue.</h2><button class="icon-button" data-close="evidence-dialog" aria-label="Close evidence">${icon("close")}</button></div>${body}`;
  dialog.showModal();
}
function setMetric(index) {
  const { group } = selectedMetrics(state);
  state.metricIndex = Math.max(0, Math.min(group.length - 1, index));
  render({ keepScroll: true });
}

document.addEventListener("click", async (event) => {
  if (event.target.closest(".skip-link")) {
    event.preventDefault();
    $("screen").focus();
    return;
  }
  const button = event.target.closest("button");
  if (!button || button.disabled) return;
  try {
    if (button.dataset.close) $(button.dataset.close).close();
    else if (button.dataset.go) go(button.dataset.go);
    else if (button.dataset.drill) {
      state.drillId = button.dataset.drill;
      go("drill");
    } else if (button.hasAttribute("data-sample"))
      await withBusy(async () => {
        await loadSample();
        await sessionMedia(state.session.session_id);
        go("review");
      });
    else if (button.dataset.session)
      await withBusy(async () => {
        await select(button.dataset.session);
        go("review");
      });
    else if (button.hasAttribute("data-import")) openImport();
    else if (button.hasAttribute("data-save-drill")) {
      const saved = state.preferences.saved,
        index = saved.indexOf(state.drillId);
      if (index < 0) saved.push(state.drillId);
      else saved.splice(index, 1);
      savePreferences();
      render({ keepScroll: true });
      toast(
        index < 0
          ? "Drill saved to your practice library."
          : "Drill removed from saved practice.",
      );
    } else if (button.dataset.filter) {
      state.libraryFilter = button.dataset.filter;
      render({ keepScroll: true });
    } else if (button.dataset.range) {
      state.progressRange = button.dataset.range;
      render({ keepScroll: true });
    } else if (button.hasAttribute("data-metric"))
      setMetric(Number(button.dataset.metric));
    else if (button.hasAttribute("data-sample-overlay")) {
      state.sampleOverlay = !state.sampleOverlay;
      render({ keepScroll: true });
    } else if (button.dataset.evidenceId)
      showEvidence(button.dataset.evidenceType, button.dataset.evidenceId);
    else if (button.dataset.question) {
      state.question = button.dataset.question;
      $("question").value = button.dataset.question;
      $("question").focus();
    } else if (button.hasAttribute("data-export-session") && state.session)
      downloadJSON(state.session, `session-${state.session.session_id}.json`);
    else if (button.hasAttribute("data-export-report") && state.run)
      downloadJSON(state.run, `review-${state.run.run_id}.json`);
    else if (button.hasAttribute("data-enable-camera")) {
      const ticket = ++cameraEpoch;
      button.disabled = true;
      try {
        await openCamera();
        if (ticket !== cameraEpoch || state.screen !== "record") closeCamera();
        else render({ keepScroll: true });
      } finally {
        button.disabled = false;
      }
    } else if (button.hasAttribute("data-start-recording")) {
      if (document.querySelector(".setup-checks input:not(:checked)")) {
        toast(
          "Check your framing, fixed camera and clear space before recording.",
        );
        return;
      }
      startRecording(
        (seconds) => {
          if ($("record-clock")) $("record-clock").textContent = clock(seconds);
        },
        finish,
        (message) => {
          render({ keepScroll: true });
          notice(message);
        },
      );
      render({ keepScroll: true });
    } else if (button.hasAttribute("data-finish-recording")) await finish();
    else if (button.hasAttribute("data-upload-draft")) $("draft-file").click();
    else if (button.hasAttribute("data-attach-video"))
      $("session-video-file").click();
    else if (button.hasAttribute("data-download-clip") && getClip())
      downloadBlob(
        getClip(),
        `fencecoach-${state.session.session_id}.${getClip().type.includes("mp4") ? "mp4" : "webm"}`,
      );
    else if (button.hasAttribute("data-download-draft") && state.draftClip)
      downloadBlob(
        state.draftClip,
        `fencecoach-practice.${state.draftClip.type.includes("mp4") ? "mp4" : "webm"}`,
      );
    else if (button.hasAttribute("data-clear-draft")) {
      setDraft(null);
      render({ keepScroll: true });
    }
  } catch (error) {
    notice(error.message);
  }
});
document.addEventListener("change", async (event) => {
  const target = event.target;
  try {
    if (target.id === "session-picker")
      await withBusy(async () => {
        await select(target.value);
        render({ keepScroll: true });
      });
    else if (target.id === "metric-group") {
      state.groupIndex = Number(target.value);
      state.metricIndex = 0;
      render({ keepScroll: true });
    } else if (target.id === "rep-slider") setMetric(Number(target.value));
    else if (target.id === "mode") {
      state.mode = target.value;
      render({ keepScroll: true });
    } else if (target.id === "report-history") {
      state.run =
        state.runs.find((run) => run.run_id === target.value) || state.run;
      restoreRunFocus();
      render({ keepScroll: true });
    } else if (target.id === "trend-picker") {
      state.trendKey = target.value;
      render({ keepScroll: true });
    } else if (target.id === "json-file") {
      const file = target.files[0];
      if (!file) return;
      if (file.size > 1024 * 1024)
        throw new Error("Choose a JSON file smaller than 1 MB.");
      const data = JSON.parse(await file.text());
      if (!data || (!Array.isArray(data) && !Array.isArray(data.metrics)))
        throw new Error(
          "This JSON file needs a measurements array or a session object with metrics.",
        );
      if (!Array.isArray(data)) {
        if (data.title) $("import-name").value = data.title;
        if (["beginner", "intermediate"].includes(data.skill_level))
          $("import-skill").value = data.skill_level;
        $("import-notes").value = data.notes || "";
      }
      $("session-json").value = JSON.stringify(
        Array.isArray(data) ? data : data.metrics,
        null,
        2,
      );
      $("import-error").textContent = "";
    } else if (target.id === "draft-file") {
      const file = target.files[0];
      if (!file) return;
      validateClip(file);
      cameraEpoch++;
      closeCamera();
      setDraft(file);
      render({ keepScroll: true });
    } else if (target.id === "session-video-file") {
      const file = target.files[0];
      if (!file || !state.session) return;
      validateClip(file);
      const id = state.session.session_id;
      await saveClip(id, file);
      if (state.session?.session_id === id) {
        setClip(file);
        render({ keepScroll: true });
      }
      toast("Video saved with this session on this device.");
    }
  } catch (error) {
    if (target.id === "json-file")
      $("import-error").textContent = error.message;
    else notice(error.message);
  }
});
document.addEventListener("input", (event) => {
  if (event.target.id === "question") state.question = event.target.value;
});
document.addEventListener("submit", async (event) => {
  if (event.target.id === "coach-form") {
    event.preventDefault();
    if (state.generating || !state.session) return;
    const question = $("question").value.trim();
    if (question.length < 3) return;
    notice();
    state.question = question;
    const pending = generateReport(question);
    render({ keepScroll: true });
    try {
      await pending;
      render({ keepScroll: true });
      toast("Your coaching review has been saved.");
    } catch (error) {
      state.question = question;
      render({ keepScroll: true });
      $("question").value = question;
      notice(error.message);
    }
  } else if (event.target.id === "import-form") {
    event.preventDefault();
    const button = $("save-session");
    button.disabled = true;
    $("import-error").textContent = "";
    let saved = null;
    try {
      const parsed = JSON.parse($("session-json").value),
        metrics = Array.isArray(parsed) ? parsed : parsed.metrics;
      const draft = state.draftClip;
      saved = await importSession({
        title: $("import-name").value.trim(),
        skill_level: $("import-skill").value,
        notes: $("import-notes").value,
        metrics,
      });
      if (draft) {
        try {
          await saveClip(saved.session_id, draft);
          setDraft(null);
        } catch (error) {
          notice(error.message);
          toast(
            "Measurements saved. Download your video from Record to keep a copy.",
          );
        }
      }
      await sessionMedia(saved.session_id);
      $("import-dialog").close();
      go("review");
      if (!state.error) toast("Practice saved. Your review is ready.");
    } catch (error) {
      if (saved) {
        $("import-dialog").close();
        notice(error.message);
        go("review");
      } else $("import-error").textContent = error.message;
    } finally {
      button.disabled = false;
    }
  } else if (event.target.id === "settings-form") {
    event.preventDefault();
    const data = new FormData(event.target);
    try {
      state.preferences.goal = Number(data.get("goal"));
      state.preferences.skill = data.get("skill");
      savePreferences();
      toast("Practice preferences saved.");
    } catch (error) {
      notice(error.message);
    }
  }
});
async function init() {
  state.screen = route();
  render();
  try {
    await initStore();
    await initVideo();
    if (state.session) await sessionMedia(state.session.session_id);
    render();
  } catch (error) {
    state.loading = false;
    render();
    notice(
      `${error.message} Make sure the FenceCoach server is running, then reload.`,
    );
  }
}
setupVideoController({ state, render, go, notice, select, setDraft });
init();
