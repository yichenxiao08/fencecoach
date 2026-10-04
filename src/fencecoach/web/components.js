import {
  e,
  icon,
  primary,
  secondary,
  date,
  groups,
  label,
  pretty,
  displayMetric,
} from "./ui.js";
import { drills } from "./practice-library.js";
export function drillRows(list = drills, saved = []) {
  return `<div class="drill-list">${list.map((drill, i) => `<button class="drill-row" data-drill="${e(drill.id)}"><div class="drill-thumbnail crop-${i}"><img src="/static/fencing-editorial.png" alt="" /></div><div><span>${e(drill.level)}${saved.includes(drill.id) ? " / SAVED" : ""}</span><strong>${e(drill.name)}</strong><small>${drill.minutes} min · Guided practice</small></div>${icon("chevron")}</button>`).join("")}</div>`;
}
export function sessionRows(sessions, currentId = null) {
  if (!sessions.length)
    return '<p class="empty-note">Your practice history starts with your first saved session.</p>';
  return `<div class="practice-log">${sessions.map((session) => `<button data-session="${e(session.session_id)}" class="${currentId === session.session_id ? "selected" : ""}"><span class="log-icon">${icon(session.is_demo ? "spark" : "target")}</span><div><strong>${e(session.title)}</strong><small>${e(date(session.practiced_on ? session.practiced_on + "T12:00:00" : session.created_at))} · ${session.metrics.length} measurements${session.is_demo ? " · Sample" : ""}</small></div>${icon("chevron")}</button>`).join("")}</div>`;
}
export function sessionPicker(state) {
  return `<label class="field session-picker"><span>Practice session</span><select id="session-picker" ${state.loadingSession || state.generating ? "disabled" : ""}>${state.sessions.map((s) => `<option value="${e(s.session_id)}" ${s.session_id === state.session?.session_id ? "selected" : ""}>${e(s.title)}${s.is_demo ? " · Sample" : ""}</option>`).join("")}</select></label>`;
}
export function emptySession(title = "One session. One clear focus.") {
  return `<div class="empty-session"><span class="empty-symbol">${icon("target")}</span><h2>${e(title)}</h2><p>Import your practice measurements to review them, or explore a sample first.</p>${primary("Explore sample session", "data-sample")}${secondary("Import a practice session", "data-import")}<small>Sample measurements are synthetic. No video has been analyzed.</small></div>`;
}
export function modePicker(state) {
  return `<label class="field"><span>Coaching model</span><select id="mode"><option value="local" ${state.mode === "local" ? "selected" : ""} ${!state.config.local_ready ? "disabled" : ""}>Local AI ${!state.config.local_ready ? "· setup needed" : "· private"}</option><option value="bedrock" ${state.mode === "bedrock" ? "selected" : ""} ${!state.config.bedrock_ready ? "disabled" : ""}>Cloud AI ${!state.config.bedrock_ready ? "· setup needed" : ""}</option><option value="demo" ${state.mode === "demo" ? "selected" : ""}>Sample report · no LLM</option></select></label><p class="helper">${state.mode === "local" ? "Your model uses video measurements, retrieved notes, your journal, and previous reviews. Video stays on this server." : state.mode === "bedrock" ? "Cloud coaching sends measurements and training context to the configured provider. Provider charges apply." : "Sample reports summarize evidence. They do not interpret questions."}</p>`;
}
export function metricEvidence(metric, isDemo) {
  const display = displayMetric(metric);
  let baseline = "No baseline was supplied for this measurement.";
  if (metric.baseline_value != null) {
    const base = displayMetric({ ...metric, value: metric.baseline_value });
    const delta = displayMetric({
      ...metric,
      value: metric.value - metric.baseline_value,
    });
    baseline = `Supplied baseline: ${base.value} ${base.unit}. Change: ${Number(delta.value) > 0 ? "+" : ""}${delta.value} ${delta.unit}. A numeric change alone does not establish better technique.`;
  }
  return `<div class="source-explainer"><p class="eyebrow">${metric.provenance ? "REVIEWED VIDEO EVIDENCE" : isDemo ? "SYNTHETIC SAMPLE" : "SUPPLIED MEASUREMENT"}</p><h3>${e(label(metric.name))}</h3><p><strong>${e(display.value)} ${e(display.unit)}</strong> · ${metric.provenance?.annotation === "manual_window" ? "Manually marked / tracking quality unavailable" : `${Math.round(metric.confidence * 100)}% ${metric.provenance ? "landmark quality" : "supplied confidence"}`}.</p><p>${e(baseline)}</p>${metric.start_ms != null ? `<p>Marked window: ${pretty(metric.start_ms / 1000)}s${metric.end_ms != null ? `–${pretty(metric.end_ms / 1000)}s` : ""}.</p>` : ""}${metric.provenance ? `<p>${e(metric.provenance.quality_note)}</p><p>Method: ${e(metric.provenance.method)} · ${e(metric.provenance.annotation.replaceAll("_", " "))}</p>` : ""}<code>${e(metric.metric_id)}</code></div>`;
}
export function evidenceChips(refs = []) {
  return `<div class="evidence-chips">${refs.map((ref) => `<button data-evidence-type="${e(ref.source_type)}" data-evidence-id="${e(ref.source_id)}" title="${e(ref.note)}">${icon("arrow")} ${e(label(ref.note).slice(0, 65))}</button>`).join("")}</div>`;
}
function athleteText(text, run) {
  let output = text;
  const references = [
    ...run.report.observations.flatMap((o) => o.evidence),
    ...(run.report.next_drill?.evidence || []),
  ];
  for (const ref of references) {
    output = output
      .replaceAll(` (${ref.source_id})`, "")
      .replaceAll(` from ${ref.source_id}`, "");
    if (ref.note.includes("_") && /^[a-z_]+$/.test(ref.note))
      output = output.replaceAll(ref.note, label(ref.note));
  }
  return output.charAt(0).toUpperCase() + output.slice(1);
}
export function reportContent(run, { compact = false } = {}) {
  if (!run) return "";
  return `<div class="report-content"><div class="report-label">${icon("spark")} ${run.mode === "demo" ? "DEMO REVIEW / NO AI CALLS" : "SESSION COACH"}</div><p class="report-summary">${e(athleteText(run.report.summary, run))}</p>${run.report.observations.map((observation) => `<div class="observation"><p>${e(athleteText(observation.claim, run))}</p>${evidenceChips(observation.evidence)}</div>`).join("")}${!compact && run.report.next_drill ? recommendation(run.report.next_drill, run.run_id) : ""}<details class="disclosure"><summary>What this review can tell you ${icon("chevron")}</summary><ul>${run.report.limitations.map((limitation) => `<li>${e(limitation)}</li>`).join("")}</ul></details></div>`;
}
export function recommendation(drill, runId) {
  return `<div class="recommendation"><p class="eyebrow">NEXT PRACTICE</p><h3>${e(drill.name)}</h3><ol>${drill.steps.map((step) => `<li>${e(step)}</li>`).join("")}</ol><p class="helper">Look for: ${e(drill.success_criterion)}</p>${evidenceChips(drill.evidence)}${runId ? `<button class="secondary-action" data-save-plan="${e(runId)}">Save to my training ${icon("flag")}</button>` : ""}</div>`;
}
export function runDetails(run) {
  return `<details class="disclosure"><summary>Report details ${icon("chevron")}</summary><dl class="run-details"><div><dt>Source ID check</dt><dd>${run.citation_ids_valid ? `${run.citation_count} references checked` : "Failed"}</dd></div><div><dt>Report time</dt><dd>${pretty(run.latency_ms)} ms</dd></div><div><dt>Retrieval</dt><dd>${e(run.retrieval_method)}</dd></div><div><dt>Tokens / input, output</dt><dd>${run.input_tokens}, ${run.output_tokens}</dd></div>${run.model_id ? `<div><dt>Model</dt><dd>${e(run.model_id)}</dd></div>` : ""}</dl><ol class="trace">${run.trace.map((event) => `<li><strong>${e(event.step)}</strong><span>${pretty(event.elapsed_ms)} ms · ${e(event.detail)}</span></li>`).join("")}</ol><p class="helper">Source ID checks verify that a reference exists, not that a coaching claim is correct.</p><button class="text-action" data-export-report>Export this report ${icon("arrow")}</button></details>`;
}
export function measurementTable(session) {
  return `<details class="disclosure"><summary>All session measurements ${icon("chevron")}</summary><div class="table-wrap"><table><thead><tr><th>Measurement</th><th>Value</th><th>Confidence</th></tr></thead><tbody>${session.metrics.map((metric) => `<tr><td><button class="text-action" data-evidence-type="metric" data-evidence-id="${e(metric.metric_id)}">${e(label(metric.name))}</button><code>${e(metric.metric_id)}</code></td><td>${e(pretty(metric.value))} ${e(metric.unit)}</td><td class="${metric.confidence < 0.65 ? "low-confidence" : ""}">${Math.round(metric.confidence * 100)}%</td></tr>`).join("")}</tbody></table></div><button class="text-action" data-export-session>Export session ${icon("arrow")}</button></details>`;
}
export function selectedMetrics(state) {
  const all = groups(state.session?.metrics);
  const group = all[state.groupIndex] || all[0] || [];
  const metric = group[state.metricIndex] || group[0];
  return { all, group, metric };
}
