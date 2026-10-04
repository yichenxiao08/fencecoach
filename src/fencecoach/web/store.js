import { api, sessionPath } from "./api-client.js";
import { groups } from "./ui.js";
function read(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
export const state = {
  config: {},
  sessions: [],
  logs: [],
  plans: [],
  session: null,
  runs: [],
  run: null,
  screen: "train",
  drillId: "lunge",
  metricIndex: 0,
  groupIndex: 0,
  sampleOverlay: true,
  progressRange: "week",
  trendKey: "",
  libraryFilter: "all",
  mode: "local",
  question:
    "Review my recovery measurements and suggest one focus for next practice.",
  preferences: read("fencecoach.preferences", {
    goal: 3,
    skill: "beginner",
    saved: [],
  }),
  loading: true,
  loadingSession: false,
  generating: false,
  busy: false,
  error: "",
  draftClip: null,
  videoJob: null,
  videoResult: null,
  videoWindows: [],
  videoJobs: [],
  reviewResult: null,
  videoOverlay: true,
};
// Treat persisted preferences as user data, not trusted renderable markup.
const stored = state.preferences || {};
state.preferences = {
  goal:
    Number.isInteger(stored.goal) && stored.goal >= 1 && stored.goal <= 14
      ? stored.goal
      : 3,
  skill: ["beginner", "intermediate"].includes(stored.skill)
    ? stored.skill
    : "beginner",
  saved: Array.isArray(stored.saved)
    ? stored.saved.filter((id) => ["lunge", "footwork", "control"].includes(id))
    : [],
};
let epoch = 0;
export function savePreferences() {
  try {
    localStorage.setItem(
      "fencecoach.preferences",
      JSON.stringify(state.preferences),
    );
  } catch {
    throw new Error(
      "Your browser couldn’t save these preferences. Check available storage.",
    );
  }
}
export async function initStore() {
  const [config, sessions, logs, plans] = await Promise.all([
    api("/api/config"),
    api("/api/sessions"),
    api("/api/training-logs"),
    api("/api/practice-plans"),
  ]);
  state.config = config;
  state.logs = logs;
  state.plans = plans;
  state.mode = config.local_ready
    ? "local"
    : config.bedrock_ready
      ? "bedrock"
      : "demo";
  state.sessions = sessions;
  let saved;
  try {
    saved = localStorage.getItem("fencecoach.session");
  } catch {
    /* Optional storage. */
  }
  const latest = sessions.find((s) => s.session_id === saved) || sessions[0];
  if (latest) await selectSession(latest.session_id);
  state.loading = false;
}
export async function selectSession(id) {
  const ticket = ++epoch;
  state.loadingSession = true;
  try {
    const [session, runs] = await Promise.all([
      api(sessionPath(id)),
      api(`${sessionPath(id)}/reports`),
    ]);
    if (ticket !== epoch) return false;
    state.session = session;
    state.runs = runs;
    state.run = runs[0] || null;
    state.metricIndex = 0;
    state.groupIndex = 0;
    restoreRunFocus();
    state.question =
      "Review my supplied measurements and suggest one focus for next practice.";
    try {
      localStorage.setItem("fencecoach.session", id);
    } catch {
      /* Session still works. */
    }
    return true;
  } finally {
    if (ticket === epoch) state.loadingSession = false;
  }
}
export async function refreshSessions() {
  state.sessions = await api("/api/sessions");
}
export function restoreRunFocus() {
  const id = state.run?.focus_metric_id;
  if (!id || !state.session) return;
  const all = groups(state.session.metrics);
  const group = all.findIndex((items) =>
    items.some((metric) => metric.metric_id === id),
  );
  if (group >= 0) {
    state.groupIndex = group;
    state.metricIndex = all[group].findIndex(
      (metric) => metric.metric_id === id,
    );
  }
}
export async function loadSample() {
  const existing = state.sessions.find((s) => s.is_demo && !s.video_job_id);
  const session = existing || (await api("/api/demo", { method: "POST" }));
  if (!existing) await refreshSessions();
  await selectSession(session.session_id);
}
export async function importSession(data) {
  const session = await api("/api/sessions", {
    method: "POST",
    body: JSON.stringify(data),
  });
  await refreshSessions();
  await selectSession(session.session_id);
  return session;
}
export async function generateReport(question) {
  if (!state.session || state.generating) return;
  const id = state.session.session_id;
  const focus = groups(state.session.metrics)[state.groupIndex]?.[
    state.metricIndex
  ];
  state.generating = true;
  try {
    const job = await api(`${sessionPath(id)}/coaching-jobs`, {
      method: "POST",
      body: JSON.stringify({
        question,
        mode: state.mode,
        focus_metric_id: focus?.metric_id,
      }),
    });
    state.coachingJob = job;
    try {
      localStorage.setItem("fencecoach.coachingJob", job.job_id);
    } catch {}
    const run = await waitForCoaching(job.job_id);
    if (state.session?.session_id === id) {
      state.runs.unshift(run);
      state.run = run;
      state.question = "";
    }
    return run;
  } finally {
    state.generating = false;
  }
}

export async function waitForCoaching(id) {
  const started = Date.now();
  while (Date.now() - started < 20 * 60 * 1000) {
    const job = await api(`/api/coaching-jobs/${encodeURIComponent(id)}`);
    state.coachingJob = job;
    const stage = document.getElementById("coaching-stage");
    if (stage) stage.textContent = job.stage;
    if (job.status === "completed") {
      try {
        localStorage.removeItem("fencecoach.coachingJob");
      } catch {}
      return api(`/api/reports/${encodeURIComponent(job.run_id)}`);
    }
    if (job.status === "failed") {
      try {
        localStorage.removeItem("fencecoach.coachingJob");
      } catch {}
      throw new Error(job.error || "Coaching request failed. Try again.");
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  throw new Error(
    "Your coaching request is still running. Reload to reconnect to its progress.",
  );
}

export async function resumeCoaching(onState = () => {}) {
  let id;
  try {
    id = localStorage.getItem("fencecoach.coachingJob");
  } catch {}
  if (!id) return;
  const job = await api(`/api/coaching-jobs/${encodeURIComponent(id)}`);
  if (state.session?.session_id !== job.session_id)
    await selectSession(job.session_id);
  state.generating = true;
  onState();
  try {
    const run = await waitForCoaching(id);
    if (state.session?.session_id === run.session_id) {
      state.runs = await api(`${sessionPath(run.session_id)}/reports`);
      state.run = run;
    }
  } finally {
    state.generating = false;
  }
}
