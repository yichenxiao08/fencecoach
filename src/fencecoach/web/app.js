"use strict";
const $ = (id) => document.getElementById(id);
const escapeHTML = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const pretty = (value) =>
  Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 });
let sessions = [],
  current = null,
  runs = [],
  selectedRun = null,
  config = {},
  epoch = 0,
  generating = false;

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await response.json();
  if (!response.ok) {
    let message = data.detail || "Request failed.";
    if (Array.isArray(message))
      message = message
        .map((e) => `${e.loc.slice(1).join(".")}: ${e.msg}`)
        .join("\n");
    throw new Error(message);
  }
  return data;
}
function notice(text) {
  $("notice").textContent = text;
  $("notice").classList.toggle("hidden", !text);
}
function date(value) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function download(data, filename) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function refreshSessions() {
  sessions = await api("/api/sessions");
  $("session-list").innerHTML =
    sessions
      .map(
        (s) =>
          `<button class="session-item ${current?.session_id === s.session_id ? "selected" : ""}" data-session="${escapeHTML(s.session_id)}"><strong>${escapeHTML(s.title)}</strong><small>${s.is_demo ? "Sample · " : ""}${date(s.created_at)}</small></button>`,
      )
      .join("") ||
    '<p class="sidebar-muted">Your sessions will appear here.</p>';
  $("session-picker").innerHTML = sessions
    .map(
      (s) =>
        `<option value="${escapeHTML(s.session_id)}">${escapeHTML(s.title)}</option>`,
    )
    .join("");
  if (current) $("session-picker").value = current.session_id;
  document
    .querySelectorAll("[data-session]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        selectSession(button.dataset.session),
      ),
    );
}
async function selectSession(id) {
  const ticket = ++epoch;
  try {
    const session = await api(`/api/sessions/${encodeURIComponent(id)}`);
    if (ticket !== epoch) return;
    current = session;
    runs = [];
    selectedRun = null;
    notice("");
    $("empty-state").classList.add("hidden");
    $("workspace").classList.remove("hidden");
    $("report-section").classList.add("hidden");
    renderSession();
    localStorage.setItem("fencecoach.session", id);
    await refreshSessions();
    const saved = await api(`/api/sessions/${encodeURIComponent(id)}/reports`);
    if (ticket !== epoch) return;
    runs = saved;
    if (runs.length) renderReport(runs[0]);
  } catch (error) {
    if (ticket === epoch) notice(error.message);
  }
}
function renderSession() {
  $("session-title").textContent = current.title;
  $("session-meta").textContent =
    `${date(current.created_at)} · Foil · ${current.skill_level} · ${current.metrics.length} measurements`;
  $("session-kind").textContent = current.is_demo
    ? "SAMPLE DATA"
    : "IMPORTED DATA";
  $("session-notes").textContent = current.notes;
  $("sample-banner").classList.toggle("hidden", !current.is_demo);
  const metrics = current.metrics;
  const groups = new Map();
  metrics.forEach((m) => {
    const key = `${m.name}|${m.unit}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  });
  const group = [...groups.values()].sort((a, b) => b.length - a.length)[0];
  const mean = group.reduce((sum, m) => sum + m.value, 0) / group.length;
  const confidence =
    metrics.reduce((sum, m) => sum + m.confidence, 0) / metrics.length;
  const low = metrics.filter((m) => m.confidence < 0.65).length;
  const stat = (label, value, unit, sub) =>
    `<div class="stat-card"><span class="label">${escapeHTML(label)}</span><span class="value">${escapeHTML(value)}</span><span class="unit">${escapeHTML(unit)}</span><div class="sub">${escapeHTML(sub)}</div></div>`;
  $("stats").innerHTML =
    stat(
      group[0].name.replaceAll("_", " "),
      pretty(mean),
      group[0].unit,
      `Mean of ${group.length} supplied values`,
    ) +
    stat("Measurements", metrics.length, "", "Timestamped session evidence") +
    stat(
      "Mean confidence",
      Math.round(confidence * 100),
      "%",
      "Provided by your measurement source",
    ) +
    stat("Low confidence", low, "", "Below 65% · review before concluding");
  $("metric-count").textContent = `${metrics.length} values`;
  $("metric-table").innerHTML = metrics
    .map(
      (m) =>
        `<tr id="metric-${escapeHTML(m.metric_id)}"><td>${escapeHTML(m.name.replaceAll("_", " "))}<small>${escapeHTML(m.metric_id)}${m.start_ms != null ? ` · ${(m.start_ms / 1000).toFixed(1)}s` : ""}</small></td><td>${pretty(m.value)} ${escapeHTML(m.unit)}${m.baseline_value != null ? `<small>Baseline ${pretty(m.baseline_value)} ${escapeHTML(m.unit)}</small>` : ""}</td><td><span class="confidence ${m.confidence < 0.65 ? "low" : ""}">${Math.round(m.confidence * 100)}%</span></td></tr>`,
    )
    .join("");
  renderChart(group);
}
function renderChart(group) {
  if (group.length < 2) {
    $("chart").innerHTML = "";
    return;
  }
  const values = group.map((m) => m.value),
    min = Math.min(...values),
    max = Math.max(...values);
  const range = max - min || 1;
  const points = values.map((v, i) => [
    12 + (i * 476) / (values.length - 1),
    88 - ((v - min) / range) * 64,
  ]);
  const line = points.map((p) => p.join(",")).join(" ");
  $("chart").innerHTML =
    `<p class="chart-title">${escapeHTML(group[0].name.replaceAll("_", " "))} / ${escapeHTML(group[0].unit)}</p><svg class="metric-chart" role="img" aria-label="Measurement values across repetitions" viewBox="0 0 500 110" preserveAspectRatio="none"><path d="M12 25H488 M12 58H488 M12 90H488" stroke="#edf0e7" fill="none"/><polygon points="12,100 ${line} 488,100" fill="#f2f7e8"/><polyline points="${line}" fill="none" stroke="#93b95d" stroke-width="2.5"/>${points.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="${group[i].confidence < 0.65 ? "#cba875" : "#93b95d"}"><title>${escapeHTML(group[i].metric_id)}: ${pretty(values[i])} ${escapeHTML(group[i].unit)}</title></circle>`).join("")}</svg><div class="chart-labels"><span>First value · ${pretty(values[0])}</span><span>Last value · ${pretty(values.at(-1))}</span></div>`;
}
function chips(refs) {
  return refs
    .map(
      (ref) =>
        `<button class="evidence-chip" data-source-type="${escapeHTML(ref.source_type)}" data-source-id="${escapeHTML(ref.source_id)}" title="${escapeHTML(ref.note)}">↗ ${escapeHTML(ref.source_id)}</button>`,
    )
    .join("");
}
function renderReport(run) {
  selectedRun = run;
  $("report-section").classList.remove("hidden");
  $("report-history").innerHTML = runs
    .map(
      (r) =>
        `<option value="${r.run_id}">${date(r.created_at)} · ${r.mode === "demo" ? "Demo" : "Live AI"}</option>`,
    )
    .join("");
  $("report-history").value = run.run_id;
  $("report-badge").textContent =
    run.mode === "demo" ? "DEMO · NO LLM CALLS" : "LIVE AI · BEDROCK";
  $("report-question").textContent = `You asked: ${run.question}`;
  $("report-summary").textContent = run.report.summary;
  $("observations").innerHTML =
    run.report.observations
      .map(
        (o) =>
          `<div class="observation"><p>${escapeHTML(o.claim)}</p>${chips(o.evidence)}</div>`,
      )
      .join("") ||
    '<p class="muted">No supported observations were produced.</p>';
  const drill = run.report.next_drill;
  $("drill").innerHTML = drill
    ? `<div class="drill-card"><p class="eyebrow">NEXT PRACTICE</p><h4>${escapeHTML(drill.name)}</h4><ol>${drill.steps.map((s) => `<li>${escapeHTML(s)}</li>`).join("")}</ol><p class="criterion">Look for: ${escapeHTML(drill.success_criterion)}</p>${chips(drill.evidence)}</div>`
    : '<p class="muted">No drill recommended from the available evidence.</p>';
  const stat = (label, value) =>
    `<div class="run-stat"><span>${escapeHTML(label)}</span><b>${escapeHTML(value)}</b></div>`;
  $("run-stats").innerHTML =
    stat(
      "Source ID check",
      run.citation_ids_valid
        ? `${run.citation_count} references checked`
        : "Failed",
    ) +
    stat("Report latency", `${pretty(run.latency_ms)} ms`) +
    stat(
      "Retrieval",
      run.retrieval_method === "bm25"
        ? "BM25 · local notes"
        : "Bedrock embeddings",
    ) +
    stat("Tokens (in / out)", `${run.input_tokens} / ${run.output_tokens}`) +
    (run.model_id ? stat("Model", run.model_id) : "");
  $("sources").innerHTML =
    run.sources
      .map(
        (s) =>
          `<div class="source-card" id="source-${escapeHTML(s.source_id)}"><strong>${escapeHTML(s.source)}</strong><p>${escapeHTML(s.text)}</p><code>${escapeHTML(s.source_id)}</code></div>`,
      )
      .join("") || '<p class="muted">No matching notes retrieved.</p>';
  $("trace").innerHTML = run.trace
    .map(
      (t) =>
        `<li class="trace-item"><strong>${escapeHTML(t.step)} · ${pretty(t.elapsed_ms)} ms</strong><small>${escapeHTML(t.detail)}</small></li>`,
    )
    .join("");
  $("limitations").innerHTML = run.report.limitations
    .map((l) => `<li>${escapeHTML(l)}</li>`)
    .join("");
  document.querySelectorAll("[data-source-id]").forEach((button) =>
    button.addEventListener("click", () => {
      const prefix =
        button.dataset.sourceType === "metric" ? "metric-" : "source-";
      const target = $(prefix + button.dataset.sourceId);
      if (!target) return;
      const detail = target.closest("details");
      if (detail) detail.open = true;
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.classList.add("highlight");
      setTimeout(() => target.classList.remove("highlight"), 2200);
    }),
  );
}
async function loadDemo() {
  $("load-demo").disabled = true;
  try {
    const session = await api("/api/demo", { method: "POST" });
    await selectSession(session.session_id);
  } catch (error) {
    notice(error.message);
  } finally {
    $("load-demo").disabled = false;
  }
}
function openImport() {
  $("import-error").textContent = "";
  if (!$("session-json").value)
    $("session-json").value = JSON.stringify(
      {
        title: "My practice session",
        skill_level: "beginner",
        notes: "",
        metrics: [
          {
            metric_id: "rep-01-recovery",
            name: "recovery_time",
            value: 920,
            unit: "ms",
            confidence: 0.88,
            baseline_value: 1050,
            start_ms: 2400,
            end_ms: 3320,
          },
        ],
      },
      null,
      2,
    );
  $("import-dialog").showModal();
}
$("coach-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!current || generating) return;
  const sessionId = current.session_id;
  generating = true;
  $("generate-button").disabled = true;
  $("generate-button").textContent = "Reviewing…";
  notice("");
  try {
    const run = await api(
      `/api/sessions/${encodeURIComponent(sessionId)}/reports`,
      {
        method: "POST",
        body: JSON.stringify({
          question: $("question").value,
          mode: $("mode").value,
        }),
      },
    );
    if (current.session_id === sessionId) {
      runs.unshift(run);
      renderReport(run);
      $("report-section").scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
  } catch (error) {
    notice(error.message);
  } finally {
    generating = false;
    $("generate-button").disabled = false;
    $("generate-button").textContent = "Review session ↗";
  }
});
$("import-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("import-error").textContent = "";
  $("save-session").disabled = true;
  try {
    const session = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify(JSON.parse($("session-json").value)),
    });
    $("import-dialog").close();
    await selectSession(session.session_id);
  } catch (error) {
    $("import-error").textContent = error.message;
  } finally {
    $("save-session").disabled = false;
  }
});
$("json-file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 1024 * 1024) {
    $("import-error").textContent =
      "Please use a session file smaller than 1 MB.";
    return;
  }
  $("session-json").value = await file.text();
});
$("report-history").addEventListener("change", (event) => {
  const run = runs.find((r) => r.run_id === event.target.value);
  if (run) renderReport(run);
});
$("mode").addEventListener("change", () => {
  $("mode-note").textContent =
    $("mode").value === "demo"
      ? "Demo summarizes supplied values. No LLM or paid API calls."
      : "Live AI uses your configured AWS model. Provider charges apply; source IDs are checked before saving.";
});
$("load-demo").addEventListener("click", loadDemo);
$("session-picker").addEventListener("change", (event) =>
  selectSession(event.target.value),
);
$("import-button").addEventListener("click", openImport);
$("new-session").addEventListener("click", openImport);
$("close-import").addEventListener("click", () => $("import-dialog").close());
$("download-session").addEventListener(
  "click",
  () => current && download(current, `session-${current.session_id}.json`),
);
$("download-report").addEventListener(
  "click",
  () =>
    selectedRun && download(selectedRun, `report-${selectedRun.run_id}.json`),
);
$("dashboard-nav").addEventListener("click", () =>
  window.scrollTo({ top: 0, behavior: "smooth" }),
);
document.querySelectorAll("[data-question]").forEach((button) =>
  button.addEventListener("click", () => {
    $("question").value = button.dataset.question;
    $("question").focus();
  }),
);
async function init() {
  try {
    config = await api("/api/config");
    const option = $("mode").querySelector('[value="bedrock"]');
    option.disabled = !config.live_configured;
    if (!config.live_configured)
      option.textContent = "Live AI · configure AWS first";
    await refreshSessions();
    const saved = localStorage.getItem("fencecoach.session");
    if (sessions.length)
      await selectSession(
        sessions.some((s) => s.session_id === saved)
          ? saved
          : sessions[0].session_id,
      );
  } catch (error) {
    notice(error.message);
  }
}
init();
