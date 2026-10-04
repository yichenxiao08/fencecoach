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
  mode: "demo",
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
  const [config, sessions] = await Promise.all([
    api("/api/config"),
    api("/api/sessions"),
  ]);
  state.config = config;
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
  const existing = state.sessions.find((s) => s.is_demo);
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
    const run = await api(`${sessionPath(id)}/reports`, {
      method: "POST",
      body: JSON.stringify({
        question,
        mode: state.mode,
        focus_metric_id: focus?.metric_id,
      }),
    });
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
