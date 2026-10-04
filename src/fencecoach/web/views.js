import {
  e,
  icon,
  primary,
  secondary,
  heading,
  photo,
  date,
  clock,
  label,
  pretty,
  groups,
  mean,
  displayMetric,
  practiceStats,
  periodStart,
  dayKey,
  trendChart,
} from "./ui.js";
import { drills, findDrill } from "./practice-library.js";
import { capture, getClipURL } from "./media.js";
import {
  drillRows,
  sessionRows,
  sessionPicker,
  emptySession,
  modePicker,
  metricEvidence,
  reportContent,
  runDetails,
  measurementTable,
  selectedMetrics,
} from "./components.js";

export function train(state) {
  const stats = practiceStats(state.sessions),
    focus = findDrill(state.drillId),
    latest = stats.real[0];
  return `${heading("READY WHEN YOU ARE", "Make your<br>next touch count.", `<span class="heading-date">${e(date(new Date(), true))}</span>`)}
  <div class="training-layout"><section><div class="week-strip"><div>${icon("streak")}<strong>${stats.streak ? `${stats.streak}-day practice streak` : "Your next practice starts here"}</strong></div><span>${stats.week.length} / ${state.preferences.goal} THIS WEEK</span></div>
  ${photo("piste-feature", `<span class="image-badge">TODAY’S FOCUS / ${focus.minutes} MIN</span><div class="image-footer"><h2>${focus.title}</h2><button class="round-action" data-drill="${e(focus.id)}" aria-label="Start ${e(focus.name)} drill">${icon("arrow")}</button></div>`)}
  ${primary("Start training", `data-drill="${e(focus.id)}"`)}<div class="home-shortcuts"><button data-sample>${icon("play")}Explore sample review</button><button data-import>${icon("upload")}Import a session</button></div>
  </section><aside class="training-aside"><div class="section-heading"><h2>Build your foundations</h2><button data-go="library">Explore ${icon("chevron")}</button></div>${drillRows(drills, state.preferences.saved)}
  <div class="daily-focus"><p class="eyebrow">ONE SESSION. ONE FOCUS.</p><h3>A controlled return.</h3><p>Reset your guard between each rep. Notice what feels repeatable. Bring one question to your next practice.</p></div>
  <div class="section-heading"><h2>${latest ? "Pick up where you left off" : "Your practice journal"}</h2><button data-go="progress">View all ${icon("chevron")}</button></div>${sessionRows(latest ? [latest] : [])}
  </aside></div>`;
}
export function library(state) {
  const filtered =
    state.libraryFilter === "saved"
      ? drills.filter((d) => state.preferences.saved.includes(d.id))
      : drills;
  return `${heading("THE PRACTICE LIBRARY", "Build your<br>foundations.")}<div class="range-control library-tabs"><button data-filter="all" class="${state.libraryFilter === "all" ? "active" : ""}">All drills</button><button data-filter="saved" class="${state.libraryFilter === "saved" ? "active" : ""}">Saved drills</button></div><div class="library-grid">${filtered.map((drill, i) => `<button class="drill-card" data-drill="${e(drill.id)}">${photo(`library-photo crop-${i}`, `<span class="image-badge">${e(drill.level)}</span>`)}<div><p class="eyebrow">${drill.minutes} MIN / GUIDED PRACTICE</p><h2>${e(drill.name)}</h2><p>${e(drill.subtitle)}</p><span>${state.preferences.saved.includes(drill.id) ? "SAVED / " : ""}Start a deliberate set ${icon("arrow")}</span></div></button>`).join("") || '<p class="empty-note">Save a drill from its practice page to keep it here.</p>'}</div>`;
}
export function drill(state) {
  const data = findDrill(state.drillId),
    saved = state.preferences.saved.includes(data.id);
  return `<div class="screen-top"><button class="text-action" data-go="library">${icon("back")}Training library</button><span>GUIDED PRACTICE / FOIL</span><button class="icon-button ${saved ? "saved" : ""}" data-save-drill aria-label="${saved ? "Remove saved drill" : "Save drill"}" aria-pressed="${saved}">${icon("flag")}</button></div><div class="drill-layout">${photo("drill-cover", `<span class="image-badge">${e(data.level)}</span><div class="image-footer"><h2>${data.title}</h2></div>`)}<section class="drill-detail"><p class="eyebrow">${data.minutes} MINUTES / ${e(data.level)}</p><h1>${e(data.name)}</h1><p class="detail-description">${e(data.subtitle)}. Keep the setup consistent and give each repetition a deliberate finish.</p><div class="drill-steps">${data.steps.map(([title, body], i) => `<div><b>0${i + 1}</b><p><strong>${e(title)}</strong><span>${e(body)}</span></p></div>`).join("")}</div>${primary("Set up camera", 'data-go="record"')}<p class="helper">${e(data.criterion)}</p><details class="disclosure"><summary>About this practice ${icon("chevron")}</summary><p>${e(data.note)} Adapt the exercise with your fencing coach.</p></details></section></div>`;
}
export function record(state) {
  const draft = state.draftClip,
    ready = capture.ready,
    recording = capture.recording;
  let preview;
  if (ready)
    preview = '<video id="camera-preview" autoplay muted playsinline></video>';
  else if (draft)
    preview = '<video id="draft-preview" controls playsinline></video>';
  else
    preview = photo(
      "camera-example",
      '<span class="image-badge">FRAMING EXAMPLE / GENERATED IMAGE</span>',
    );
  return `${heading("YOUR PRACTICE", "Move. Reset.<br>Repeat.")}<div class="record-layout"><section><div class="capture-view"><div class="capture-stage">${preview}${!draft ? '<div class="capture-corners"><i></i><i></i><i></i><i></i></div>' : ""}${ready ? `<div class="camera-top"><span class="camera-mode">${recording ? "<i></i> RECORDING" : "CAMERA PREVIEW"}</span><strong id="record-clock">${clock(capture.elapsed)}</strong></div>` : ""}${!ready && !draft ? '<div class="camera-guidance"><strong>WHOLE BODY IN FRAME</strong><p>Leave room for your lunge and recovery.</p></div>' : ""}</div><div class="capture-bottom"><span>${icon("camera")}Fixed side view</span><span>${icon("target")}One fencer</span></div></div><p class="helper">${draft ? "Your clip stays in this browser. Download a copy to keep it elsewhere." : "Camera access starts only when you choose Enable camera. Audio is not recorded."}</p></section>
  <section class="capture-info"><p class="eyebrow">${draft ? "CLIP READY" : recording ? "PRACTICE IN PROGRESS" : "BEFORE YOUR FIRST REP"}</p><h2>${draft ? "Now add the measurements." : recording ? "Make each rep count." : "Ready when you are."}</h2><p>${draft ? "Import a session’s measurements to review them alongside this clip. Automatic video analysis is still being built." : recording ? "Keep your return deliberate. Finish the recording when your set is complete." : "Place your camera side-on, then check your framing."}</p>
  ${
    draft
      ? `${primary("Import measurements & save session", "data-import")}${secondary("Download video", "data-download-draft")}${secondary("Choose another clip", "data-upload-draft")}<button class="text-action" data-clear-draft>Start again ${icon("back")}</button>`
      : `${!recording ? '<div class="setup-checks"><label><input type="checkbox" id="check-body">Whole body visible</label><label><input type="checkbox" id="check-fixed">Camera stays still</label><label><input type="checkbox" id="check-space">Space to move safely</label></div>' : ""}${recording ? '<button class="record-action" data-finish-recording><span class="record-dot"></span>Finish practice</button>' : ready ? '<button class="record-action" data-start-recording><span class="record-dot"></span>Start recording</button>' : primary("Enable camera", "data-enable-camera")}${!recording ? `${secondary("Upload an existing clip", "data-upload-draft")}<div class="capture-other"><button data-import>Import measurements only ${icon("arrow")}</button><button data-sample>Try a sample review ${icon("arrow")}</button></div>` : ""}`
  }
  <input class="sr-only" type="file" id="draft-file" accept="video/*" /><p class="subtle-note">${draft ? "Local video storage / up to 200 MB" : "Record up to 10 minutes / save a copy after practice"}</p></section></div>`;
}
export function review(state) {
  if (!state.session)
    return `${heading("SESSION REVIEW", "See the movement.")}${emptySession()}`;
  const { all, group, metric } = selectedMetrics(state),
    display = displayMetric(metric),
    clip = getClipURL();
  let cueTitle = "Start with the measurement.",
    cueBody =
      "Review the supplied value and its baseline, then ask your coach what to practice next.";
  if (metric.confidence < 0.65) {
    cueTitle = "Give this rep another look.";
    cueBody =
      "Supplied tracking confidence is lower here. Review the footage or measurement source before making a technique correction.";
  } else if (state.run) {
    cueTitle = state.run.report.next_drill
      ? "One focus for your next set."
      : "Your session, in context.";
    cueBody = state.run.report.summary;
  }
  let footage;
  if (clip)
    footage =
      '<video id="replay-video" controls playsinline preload="metadata"></video>';
  else if (state.session.is_demo)
    footage = photo(
      "sample-replay",
      `<span class="image-badge">SAMPLE IMAGE / NOT ANALYZED FOOTAGE</span><button class="overlay-toggle" data-sample-overlay aria-pressed="${state.sampleOverlay}">${icon("target")} Sample overlay ${state.sampleOverlay ? "on" : "off"}</button><div class="sample-landmarks" aria-hidden="true" ${state.sampleOverlay ? "" : "hidden"}><svg viewBox="0 0 1536 1024"><g stroke="var(--accent)" stroke-width="5" fill="none"><path d="M952 354 1229 349 1325 308M952 354 813 528 645 476M952 354 941 588 1062 576 1085 738M941 588 711 672 435 730"/></g></svg></div>`,
    );
  else
    footage = `<div class="no-footage">${icon("camera")}<h2>Bring the movement into view.</h2><p>Attach a clip recorded with the same timing as your measurements.</p><button class="secondary-action" data-attach-video>Attach session video ${icon("upload")}</button><small>Saved only in this browser. No automatic analysis.</small></div>`;
  return `${heading("SESSION REVIEW", "See the movement.", '<button class="icon-button" data-go="record" aria-label="New practice">' + icon("camera") + "</button>")}${sessionPicker(state)}<div class="review-layout"><section class="replay-column"><div class="review-caption"><span>${e(state.session.title)}</span><span>${state.session.is_demo ? "SAMPLE DATA" : "IMPORTED DATA"}</span></div><div class="replay-view">${footage}</div><div class="playback-bar"><div class="measurement-group"><label for="metric-group">MEASUREMENT</label><select id="metric-group">${all.map((items, i) => `<option value="${i}" ${i === state.groupIndex ? "selected" : ""}>${e(label(items[0].name))} · ${e(items[0].unit)}</option>`).join("")}</select></div><label for="rep-slider"><span>VALUE ${state.metricIndex + 1} OF ${group.length}</span><b>${e(metric.metric_id)}</b></label>${group.length > 1 ? `<input id="rep-slider" type="range" min="0" max="${group.length - 1}" value="${state.metricIndex}" step="1" aria-label="Select measurement"/><div class="rep-markers">${group.map((m, i) => `<button data-metric="${i}" class="${state.metricIndex === i ? "selected" : ""}" aria-label="Measurement ${i + 1}" aria-pressed="${state.metricIndex === i}">${String(i + 1).padStart(2, "0")}${m.confidence < 0.65 ? "<i></i>" : ""}</button>`).join("")}</div>` : ""}</div><p class="helper">${clip ? "Video is stored on this device. Marked time windows are supplied by the measurement file." : state.session.is_demo ? "Synthetic measurements and illustrative landmarks. No actual motion was analyzed." : "These values came from your measurement file. Attach footage to review the movement."}</p>${clip ? '<button class="text-action" data-attach-video>Replace session video ' + icon("upload") + '</button><button class="text-action" data-download-clip>Download video</button>' : ""}${measurementTable(state.session)}${state.session.notes ? `<details class="disclosure"><summary>Practice notes ${icon("chevron")}</summary><p>${e(state.session.notes)}</p></details>` : ""}<input class="sr-only" id="session-video-file" type="file" accept="video/*" /></section>
  <aside class="review-side"><div class="review-metrics"><div><span>${e(label(metric.name))}</span><strong>${e(display.value)}<small>${e(display.unit)}</small></strong></div><div><span>SUPPLIED CONFIDENCE</span><strong class="${metric.confidence < 0.65 ? "low-confidence" : ""}">${Math.round(metric.confidence * 100)}<small>%</small></strong></div></div><div class="coaching-cue ${metric.confidence < 0.65 ? "low-quality" : ""}"><p class="eyebrow">${icon("spark")}ONE THING TO TAKE AWAY</p><h2>${e(cueTitle)}</h2><p>${e(cueBody)}</p><details class="disclosure"><summary>Why this focus? ${icon("chevron")}</summary>${metricEvidence(metric, state.session.is_demo)}</details></div><div class="review-actions">${primary(state.run ? "Ask about this session" : "Review with the coach", 'data-go="coach"')}${secondary("Practice this again", 'data-drill="lunge"')}</div>${state.run ? `<details class="disclosure"><summary>Read the full review ${icon("chevron")}</summary>${reportContent(state.run, { compact: true })}</details>` : ""}<p class="subtle-note">A shorter interval alone does not establish better technique.</p></aside></div>`;
}
export function coach(state) {
  if (!state.session)
    return `${heading("SESSION COACH", "Let’s work on it.")}${emptySession("Bring a session to the conversation.")}`;
  const { metric } = selectedMetrics(state),
    value = displayMetric(metric);
  const run = state.run;
  return `${heading("SESSION COACH", "Let’s work on it.")}${sessionPicker(state)}<div class="coach-layout"><section><div class="coach-context">${photo("", "")}<div><span>CURRENT SESSION</span><strong>${e(state.session.title)}</strong><small>${e(label(metric.name))} · ${e(value.value)} ${e(value.unit)}${state.session.is_demo ? " · Sample" : ""}</small></div><button class="icon-button" data-go="review" aria-label="Back to session review">${icon("chevron")}</button></div>
  <div class="coach-conversation">${state.runs.length ? `<div class="report-history"><label for="report-history">SAVED REVIEWS</label><select id="report-history" ${state.generating ? "disabled" : ""}>${state.runs.map((r) => `<option value="${e(r.run_id)}" ${r.run_id === run?.run_id ? "selected" : ""}>${e(date(r.created_at))} · ${r.mode === "demo" ? "Demo" : "Live AI"} · ${e(r.question.slice(0, 65))}</option>`).join("")}</select></div>` : ""}${run ? `<div class="chat-message user"><span class="eyebrow">YOU ASKED</span><p>${e(run.question)}</p></div><div class="chat-message coach"><span class="coach-emblem">${icon("spark")}</span><div>${reportContent(run)}</div></div>` : `<div class="coach-welcome"><span class="coach-emblem">${icon("spark")}</span><h2>One session.<br>One next step.</h2><p>Compare your supplied measurements, understand the evidence, and leave with a practice focus.</p></div>`}
  ${state.generating ? '<div class="generating" role="status"><span class="spinner"></span>Reviewing your measurements and practice notes…</div>' : ""}</div>
  <form id="coach-form"><label for="question" class="eyebrow">WHAT WOULD YOU LIKE TO WORK ON?</label><textarea id="question" name="question" rows="2" minlength="3" maxlength="1500" required placeholder="Ask about your practice…" ${state.generating ? "disabled" : ""}>${e(state.question)}</textarea><button class="send-question" type="submit" aria-label="Generate coaching review" ${state.generating ? "disabled" : ""}>${icon("arrow")}</button></form><div class="coach-prompts"><button data-question="Compare my supplied measurements with their baselines." ${state.generating ? "disabled" : ""}>Compare with baseline</button><button data-question="Suggest one drill for my next practice using the supplied evidence." ${state.generating ? "disabled" : ""}>One drill for next time</button><button data-question="Which measurements have low confidence and what should I review?" ${state.generating ? "disabled" : ""}>Understand confidence</button></div></section>
  <aside class="coach-side"><div class="side-card">${modePicker(state)}</div>${run ? runDetails(run) : '<div class="daily-focus"><p class="eyebrow">GROUND YOUR PRACTICE</p><h3>Ask. Review.<br>Try again.</h3><p>Open a source beneath a coaching observation to see the measurement or practice note it refers to.</p></div>'}<p class="helper">Coaching notes are a development library. Review technique guidance with your fencing coach.</p></aside></div>`;
}
export function progress(state) {
  const stats = practiceStats(state.sessions),
    start = periodStart(state.progressRange),
    now = new Date();
  const period = stats.real.filter(
    (session) =>
      new Date(session.created_at) >= start &&
      new Date(session.created_at) <= now,
  );
  const days = new Set(period.map((s) => dayKey(s.created_at))),
    weekStart = periodStart("week");
  const completedDays = new Set(stats.week.map((s) => dayKey(s.created_at)));
  const allGroups = new Map();
  for (const session of period)
    for (const metrics of groups(session.metrics)) {
      const key = JSON.stringify([metrics[0].name, metrics[0].unit]);
      if (!allGroups.has(key))
        allGroups.set(key, {
          name: metrics[0].name,
          unit: metrics[0].unit,
          points: [],
        });
      allGroups
        .get(key)
        .points.push({ value: mean(metrics), created_at: session.created_at });
    }
  const selected =
    allGroups.get(state.trendKey) || allGroups.values().next().value;
  const calendar = Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(weekStart);
    dt.setDate(dt.getDate() + i);
    return dt;
  });
  return `${heading("YOUR PRACTICE", "Keep showing up.", '<button class="icon-button" data-go="settings" aria-label="Change weekly goal">' + icon("flag") + "</button>")}<div class="range-control progress-tabs"><button data-range="week" class="${state.progressRange === "week" ? "active" : ""}">This week</button><button data-range="month" class="${state.progressRange === "month" ? "active" : ""}">This month</button></div><div class="progress-layout"><section><div class="progress-hero"><div><span>PRACTICE SESSIONS</span><strong>${period.length}</strong><p>${state.progressRange === "week" ? `Weekly goal: ${state.preferences.goal} sessions` : `${days.size} practice days this month`}</p></div><div class="goal-ring ${stats.week.length >= state.preferences.goal ? "met" : ""}"><span>${stats.week.length >= state.preferences.goal ? icon("check") : `${stats.week.length}/${state.preferences.goal}`}</span><small>${stats.week.length >= state.preferences.goal ? "WEEKLY GOAL MET" : "THIS WEEK"}</small></div></div><div class="week-calendar">${calendar.map((dt) => `<div><span>${e(dt.toLocaleDateString(undefined, { weekday: "narrow" }))}</span><b class="${completedDays.has(dayKey(dt)) ? "done" : ""}">${completedDays.has(dayKey(dt)) ? icon("check") : dt.getDate()}</b></div>`).join("")}</div><p class="helper">Sample sessions are excluded. Dates reflect when measurements were imported.</p><div class="section-heading"><h2>Measurements over time</h2><span>SESSION MEANS</span></div><div class="progress-chart">${selected ? `<label class="field"><span>Compare the same measurement and unit</span><select id="trend-picker">${[...allGroups.entries()].map(([key, item]) => `<option value="${e(key)}" ${item === selected ? "selected" : ""}>${e(label(item.name))} · ${e(item.unit)}</option>`).join("")}</select></label>${trendChart(selected.points.reverse(), selected.unit)}` : '<p class="empty-note">Import practice measurements to start tracking your sessions.</p>'}<p class="helper">Matching units do not guarantee matching camera conditions. Review the setup before interpreting a trend.</p></div></section><aside><div class="journal-heading"><p class="eyebrow">YOUR TRAINING JOURNAL</p><h2>Small sessions.<br>Consistent work.</h2></div><div class="section-heading"><h2>Practice log</h2><button data-import>Add session ${icon("arrow")}</button></div>${sessionRows(stats.real, state.session?.session_id)}${state.sessions.some((s) => s.is_demo) ? `<details class="disclosure"><summary>Sample sessions ${icon("chevron")}</summary>${sessionRows(state.sessions.filter((s) => s.is_demo))}</details>` : ""}</aside></div>`;
}
export function settings(state) {
  return `${heading("YOUR TRAINING SPACE", "Make it yours.")}<div class="settings-layout"><section class="side-card"><form id="settings-form"><h2>Practice preferences</h2><label class="field"><span>Weekly practice goal</span><input name="goal" type="number" min="1" max="14" value="${state.preferences.goal}" required /></label><label class="field"><span>Level for new sessions</span><select name="skill"><option value="beginner" ${state.preferences.skill === "beginner" ? "selected" : ""}>Beginner</option><option value="intermediate" ${state.preferences.skill === "intermediate" ? "selected" : ""}>Intermediate</option></select></label><p class="helper">Saved on this device. Existing sessions keep their original skill level.</p>${primary("Save preferences", 'type="submit"')}</form></section><section><div class="daily-focus"><p class="eyebrow">YOUR SESSION COACH</p><h3>${state.config.live_configured ? "Live AI is configured." : "Start with a demo review."}</h3><p>${state.config.live_configured ? "Choose Live AI in the coach to use your server’s model. Configuration does not confirm provider access." : "Demo mode runs the coaching workflow over your measurements without making a paid AI call."}</p><details class="disclosure"><summary>Set up live coaching ${icon("chevron")}</summary><p>On the server, set <code>BEDROCK_CHAT_MODEL_ID</code> and AWS credentials, then restart FenceCoach. Optional vector retrieval uses <code>BEDROCK_EMBEDDING_MODEL_ID</code>. Credentials stay on the server.</p>${state.config.model_id ? `<p>Model: ${e(state.config.model_id)}<br>Region: ${e(state.config.region)}</p>` : ""}<p>Provider charges apply. See the repository README for setup.</p></details></div><div class="section-heading"><h2>Keep your practice</h2></div><p class="helper">Sessions and coaching reports are stored by the local server. Clips and preferences are stored in this browser. Export your measurements, reports and videos to keep a copy. Automatic motion analysis and account sync are not available yet.</p><a class="text-action" href="/static/prototypes-compare.html">See the original design study ${icon("arrow")}</a></section></div>`;
}
export const screens = {
  train,
  library,
  drill,
  record,
  review,
  coach,
  progress,
  settings,
};
