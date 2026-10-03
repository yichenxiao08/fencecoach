"use strict";
const $ = (id) => document.getElementById(id);
const e = (text) =>
  String(text ?? "").replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        ch
      ],
  );
const iconPaths = {
  home: '<path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-7h6v7"/>',
  target:
    '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>',
  camera: '<path d="M4 6h4l2-3h4l2 3h4v14H4Z"/><circle cx="12" cy="12" r="4"/>',
  chart: '<path d="M4 3v17h17M8 15l4-6 4 3 5-7"/>',
  chat: '<path d="M3 4h18v13H9l-6 4Z"/><path d="M7 9h10M7 13h7"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  back: '<path d="m14 5-7 7 7 7"/>',
  play: '<path d="m9 5 11 7-11 7Z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/>',
  streak:
    '<path d="M13 3c2 6 7 8 6 13a7 7 0 0 1-14 0c-1-3 1-6 3-8 0 3 1 4 2 4 1-2 3-5 3-9Z"/>',
  sound:
    '<path d="M3 9h4l5-4v14l-5-4H3ZM16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  flag: '<path d="M5 22V3h14l-3 4 3 4H5"/>',
  calendar: '<path d="M4 5h16v16H4ZM4 10h16M8 2v6m8-6v6"/>',
  spark: '<path d="m12 3 3 6 6 3-6 3-3 6-3-6-6-3 6-3Z"/>',
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] || iconPaths.target}</svg>`;
const concepts = {
  piste: {
    title: "Piste",
    tag: "The everyday training app",
    description:
      "The closest direction to HomeCourt’s approachable training experience: visual drills, energetic typography, one obvious start button.",
    points: [
      "A photo-led drill library",
      "A short camera setup checklist",
      "One cue before detailed analysis",
    ],
    defaultScreen: "home",
  },
  studio: {
    title: "Replay Studio",
    tag: "A performance review space",
    description:
      "Designed around the moment you watch a rep back. Your movement takes the screen; timing, phases and feedback sit directly beside it.",
    points: [
      "Replay is the main event",
      "Rep selection and phase controls",
      "Evidence one tap beneath the cue",
    ],
    defaultScreen: "review",
  },
  journal: {
    title: "Training Journal",
    tag: "A personal practice companion",
    description:
      "A calmer, more deliberate direction. Each session has one focus, a small plan, and a record of what you want to work on next.",
    points: [
      "A single daily practice intention",
      "Reflection beside measured progress",
      "A clean chronological session log",
    ],
    defaultScreen: "home",
  },
};
const screenMeta = {
  home: [
    "Train",
    "Make starting a practice session the easiest action on the screen.",
  ],
  record: [
    "Record",
    "Guide setup before recording; keep the capture view focused on the athlete.",
  ],
  review: [
    "Review",
    "Lead with footage and one coaching cue. Let detail appear when it is useful.",
  ],
  progress: [
    "Progress",
    "Give a clear picture of practice habits and comparable session measurements.",
  ],
  coach: [
    "Coach",
    "Bring follow-up questions into the context of the session you just reviewed.",
  ],
  drill: [
    "Drill",
    "Show the goal, the sequence, and a clear start action before opening the camera.",
  ],
};
const reps = [
  { time: 1.04, quality: 0.9 },
  { time: 0.99, quality: 0.88 },
  { time: 0.97, quality: 0.91 },
  { time: 0.92, quality: 0.89 },
  { time: 0.94, quality: 0.58 },
];
const drills = [
  {
    name: "Lunge & recover",
    subtitle: "Control your return to en garde",
    minutes: 5,
    level: "FOUNDATIONS",
  },
  {
    name: "Find your rhythm",
    subtitle: "Advance, pause, retreat",
    minutes: 3,
    level: "FOOTWORK",
  },
  {
    name: "Repeat with intent",
    subtitle: "Five slow reps. One clear focus.",
    minutes: 4,
    level: "CONTROL",
  },
];
const initial = new URLSearchParams(location.search);
let concept = concepts[initial.get("concept")]
  ? initial.get("concept")
  : "piste";
let activeScreen = screenMeta[initial.get("screen")]
  ? initial.get("screen")
  : concepts[concept].defaultScreen;
let selectedDrill = 0,
  selectedRep = 3,
  overlay = true,
  playing = false,
  recording = false,
  elapsed = 0,
  saved = false;
let timer = null,
  playback = null,
  toastTimer = null,
  progressRange = "week";
let messages = [];
if (initial.get("focus") === "1") document.body.classList.add("focus-mode");

function primary(text, attrs = "") {
  return `<button class="primary-action" ${attrs}>${text} ${icon("arrow")}</button>`;
}
function heading(kicker, title, extra = "") {
  return `<div class="mobile-heading"><div><p class="eyebrow">${kicker}</p><h2>${title}</h2></div>${extra}</div>`;
}
function photo(cls = "", content = "") {
  return `<div class="photo ${cls}"><img src="fencing-editorial.png" alt="Illustrative photograph of a foil fencer lunging in a training salle">${content}</div>`;
}
function cue() {
  return selectedRep === 4
    ? "Give this rep another look."
    : "Recover with control.";
}
function cueBody() {
  return selectedRep === 4
    ? "Tracking confidence is lower here. Review the footage before drawing a technique conclusion."
    : "Your measured recovery is one part of the picture. Review how you return to en garde, then try five deliberate reps.";
}
function metricPair() {
  return `<div class="review-metrics"><div><span>RECOVERY</span><strong>${reps[selectedRep].time.toFixed(2)}<small>s</small></strong></div><div><span>TRACKING CONFIDENCE</span><strong>${Math.round(reps[selectedRep].quality * 100)}<small>%</small></strong></div></div>`;
}
function home() {
  if (concept === "studio")
    return `${heading("YOUR TRAINING SPACE", "Back on the strip.", '<span class="profile-avatar">YX</span>')}<div class="session-caption"><span>LATEST SESSION</span><span>Today · 5 reps</span></div>${photo("studio-feature", `<div class="image-badge">LUNGE / RECOVERY</div><button class="large-play" data-go="review" aria-label="Open session replay">${icon("play")}</button><div class="image-footer"><h3>Watch the return.</h3><p>Five reps. One focus.</p></div>`)}<div class="studio-summary"><div><span>REPS</span><strong>05</strong></div><div><span>MEAN RECOVERY</span><strong>0.97<small>s</small></strong></div><div><span>REVIEW NEEDED</span><strong>01</strong></div></div>${primary("Start a new session", 'data-go="record"')}<div class="section-heading"><h3>Keep working on</h3><button data-go="home" data-open-drill="0">All drills ${icon("chevron")}</button></div>${drillRows(2)}`;
  if (concept === "journal")
    return `${heading("SATURDAY, OCTOBER 3", "Your practice,<br>with purpose.", '<span class="profile-avatar">YX</span>')}<div class="journal-rule"></div><div class="journal-intention"><span class="journal-index">01</span><div><p class="eyebrow">TODAY’S FOCUS</p><h3>A controlled return.</h3><p>Five slow lunges. Reset your guard between each rep. Notice what feels repeatable.</p></div></div>${photo("journal-photo", '<span class="image-badge">FOIL / FOUNDATIONS</span>')}${primary("Begin today’s practice", 'data-open-drill="0"')}<div class="section-heading"><h3>Your week, so far</h3><button data-go="progress">View journal ${icon("arrow")}</button></div><div class="journal-week"><div><strong>4</strong><span>sessions</span></div><div><strong>48</strong><span>repetitions</span></div><p>Small sessions.<br>Consistent work.</p></div><div class="journal-entry"><span>YESTERDAY</span><strong>Footwork, with a pause.</strong><p>“Slower felt easier to repeat.”</p></div>`;
  return `${heading("READY WHEN YOU ARE", "Make your<br>next touch count.", '<span class="profile-avatar">YX</span>')}<div class="week-strip"><div>${icon("streak")}<strong>4-day practice streak</strong></div><span>KEEP IT GOING</span></div>${photo("piste-feature", `<span class="image-badge">TODAY’S FOCUS / 5 MIN</span><div class="image-footer"><h3>LUNGE.<br>RECOVER.<br>REPEAT.</h3><button class="round-action" data-open-drill="0" aria-label="Start lunge and recovery drill">${icon("arrow")}</button></div>`)}${primary("Start training", 'data-open-drill="0"')}<div class="section-heading"><h3>Build your foundations</h3><button data-go="home" data-open-drill="1">Explore ${icon("chevron")}</button></div>${drillRows(3)}`;
}
function drillRows(count) {
  return `<div class="drill-list">${drills
    .slice(0, count)
    .map(
      (drill, i) =>
        `<button class="drill-row" data-open-drill="${i}"><div class="drill-thumbnail crop-${i}"><img src="fencing-editorial.png" alt=""></div><div><span>${drill.level}</span><strong>${drill.name}</strong><small>${drill.minutes} min · Guided practice</small></div>${icon("chevron")}</button>`,
    )
    .join("")}</div>`;
}
function drill() {
  const data = drills[selectedDrill];
  return `<div class="screen-top"><button class="icon-button" data-go="home" aria-label="Back to training">${icon("back")}</button><span>GUIDED PRACTICE</span><button class="icon-button ${saved ? "saved" : ""}" data-save aria-label="${saved ? "Remove saved drill" : "Save drill"}">${icon("flag")}</button></div>${photo("drill-cover", `<span class="image-badge">${data.level}</span>`)}<div class="drill-detail"><p class="eyebrow">${data.minutes} MINUTES / FOIL</p><h2>${data.name}</h2><p class="detail-description">${data.subtitle}. Keep the camera fixed and give each repetition a deliberate finish.</p><div class="drill-steps"><div><b>01</b><p><strong>Set your camera</strong><span>Side view. Whole body in frame.</span></p></div><div><b>02</b><p><strong>Practice with control</strong><span>${selectedDrill === 1 ? "Alternate one advance and one retreat." : "Complete five slow repetitions."}</span></p></div><div><b>03</b><p><strong>Review your movement</strong><span>Watch one rep. Choose one next focus.</span></p></div></div>${primary("Set up camera", 'data-go="record"')}<p class="subtle-note">Illustrative training plan · adapt with your coach.</p></div>`;
}
function record() {
  return `<div class="screen-top"><button class="icon-button" data-go="home" aria-label="Back">${icon("back")}</button><span>${recording ? "PRACTICE IN PROGRESS" : "SET UP YOUR CAMERA"}</span><button class="icon-button" data-toast="Audio cues can be configured in the finished app." aria-label="Audio cues">${icon("sound")}</button></div><div class="capture-view">${photo("", `<div class="capture-corners"><i></i><i></i><i></i><i></i></div><div class="camera-top"><span class="camera-mode">${recording ? "<i></i> RECORDING SIMULATION" : "SIDE VIEW / PREVIEW"}</span><strong id="record-clock">${clock(elapsed)}</strong></div><div class="camera-guidance"><span>${recording ? "MOVE. RESET. REPEAT." : "WHOLE BODY IN FRAME"}</span><p>${recording ? "Keep your return deliberate." : "Leave room for your lunge and recovery."}</p></div>`)}<div class="capture-bottom"><span>${icon("camera")} Fixed camera</span><span>${icon("target")} One fencer</span></div></div><div class="capture-info"><h2>${recording ? "Make each rep count." : "Ready for your first rep?"}</h2><p>${recording ? "Use Finish practice to preview your session review." : "Place your phone side-on, then check your framing."}</p>${!recording ? '<div class="setup-checks"><label><input type="checkbox" checked> Whole body visible</label><label><input type="checkbox" checked> Camera stays still</label><label><input type="checkbox" checked> Space to move safely</label></div>' : ""}<button class="record-action" ${recording ? "data-finish-recording" : "data-start-recording"}><span class="record-dot"></span>${recording ? "Finish practice" : "Start practice"}</button><p class="subtle-note">Simulated capture · no camera is accessed.</p></div>`;
}
function clock(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
function poseOverlay() {
  return `<svg class="pose-overlay ${overlay ? "" : "hide-overlay"}" viewBox="0 0 1536 1024" aria-label="Illustrative landmark overlay"><g stroke="var(--accent)" stroke-width="5" fill="none"><path d="M952 354 1229 349 1325 308M952 354 813 528 645 476M952 354 941 588 1062 576 1085 738M941 588 711 672 435 730"/></g><g fill="var(--accent)">${[
    [952, 354],
    [1229, 349],
    [1325, 308],
    [813, 528],
    [645, 476],
    [941, 588],
    [1062, 576],
    [1085, 738],
    [711, 672],
    [435, 730],
  ]
    .map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="9"/>`)
    .join("")}</g></svg>`;
}
function review() {
  const rep = reps[selectedRep];
  return `${heading("SESSION REVIEW", "See the movement.", '<button class="icon-button" data-go="record" aria-label="New practice">' + icon("camera") + "</button>")}<div class="review-caption"><span>LUNGE & RECOVERY</span><span>REP ${String(selectedRep + 1).padStart(2, "0")} / 05</span></div><div class="replay-view">${photo("", `${poseOverlay()}<span class="image-badge">ILLUSTRATIVE REPLAY</span><button class="overlay-toggle ${overlay ? "on" : ""}" data-toggle-overlay aria-pressed="${overlay}">${icon("target")} ${overlay ? "Overlay on" : "Overlay off"}</button><button class="replay-play" data-play aria-label="${playing ? "Pause" : "Play"} replay">${icon(playing ? "pause" : "play")}</button><span class="video-time">00:02 / 00:04</span>`)}</div><div class="playback-bar"><label for="rep-slider">REPETITION <b id="rep-label">${selectedRep + 1} / 5</b></label><input id="rep-slider" type="range" min="0" max="4" value="${selectedRep}" step="1" aria-label="Select repetition"><div class="rep-markers">${reps.map((r, i) => `<button data-rep="${i}" class="${selectedRep === i ? "selected" : ""}" aria-label="Repetition ${i + 1}">${String(i + 1).padStart(2, "0")}${r.quality < 0.65 ? "<i></i>" : ""}</button>`).join("")}</div></div>${metricPair()}<div class="coaching-cue ${rep.quality < 0.65 ? "low-quality" : ""}"><p class="eyebrow">${icon("spark")} ONE THING TO TAKE AWAY</p><h3>${cue()}</h3><p>${cueBody()}</p><details><summary>Why this focus? ${icon("chevron")}</summary><div class="source-explainer"><p>Sample metric: <strong>rep-0${selectedRep + 1}-recovery</strong> records ${rep.time.toFixed(2)}s. The supplied baseline is 1.10s. The interval changed by ${(rep.time - 1.1).toFixed(2)}s; this does not establish better balance.</p><p>Practice note: review a controlled return to en garde rather than maximizing one isolated number.</p><span>REFERENCE / Authored lunge and recovery notes</span></div></details></div><div class="review-actions">${primary("Ask about this rep", 'data-go="coach"')}<button class="quiet-action" data-open-drill="0">Practice this again ${icon("arrow")}</button></div>`;
}
function progress() {
  const week = progressRange === "week";
  return `${heading("YOUR PRACTICE", "Keep showing up.", '<button class="icon-button" data-toast="Your goal is three practice sessions a week." aria-label="Practice goal">' + icon("flag") + "</button>")}<div class="range-control"><button data-range="week" class="${week ? "active" : ""}">This week</button><button data-range="month" class="${!week ? "active" : ""}">This month</button></div><div class="progress-hero"><div><span>PRACTICE SESSIONS</span><strong>${week ? "4" : "14"}</strong><p>${week ? "Weekly goal: 3 sessions" : "14 deliberate sessions this month"}</p></div><div class="goal-ring"><span>${icon("check")}</span><small>GOAL MET</small></div></div><div class="week-calendar">${["M", "T", "W", "T", "F", "S", "S"].map((d, i) => `<div><span>${d}</span><b class="${[0, 2, 4, 5].includes(i) ? "done" : ""}">${[0, 2, 4, 5].includes(i) ? icon("check") : "·"}</b></div>`).join("")}</div><div class="section-heading"><h3>Recovery over time</h3><span>SAME SETUP</span></div><div class="progress-chart"><div class="chart-top"><strong>${week ? "0.97" : "1.02"}<small>s mean</small></strong><span>Sample measurements</span></div><svg viewBox="0 0 300 120" role="img" aria-label="Illustrative recovery-time trend across practice sessions"><path d="M20 20H285M20 55H285M20 90H285" stroke="var(--line)" fill="none"/><g fill="var(--muted)" font-size="10"><text x="0" y="23">1.2s</text><text x="0" y="58">1.0s</text><text x="0" y="93">0.8s</text></g><polyline points="32,38 98,50 164,58 232,62 285,67" fill="none" stroke="var(--accent)" stroke-width="3"/><g fill="var(--accent)"><circle cx="32" cy="38" r="4"/><circle cx="98" cy="50" r="4"/><circle cx="164" cy="58" r="4"/><circle cx="232" cy="62" r="4"/><circle cx="285" cy="67" r="4"/></g><g fill="var(--muted)" font-size="10"><text x="32" y="116">${week ? "Mon" : "Week 1"}</text><text x="150" y="116">${week ? "Wed" : "Week 2"}</text><text x="258" y="116">${week ? "Sat" : "Week 4"}</text></g></svg><p>A shorter interval alone does not establish better technique.</p></div><div class="section-heading"><h3>Practice log</h3><span>${week ? "4" : "14"} SESSIONS</span></div><div class="practice-log"><button data-go="review"><span class="log-icon">${icon("target")}</span><div><strong>Lunge & recovery</strong><small>Today · 5 reps · 5 min</small></div>${icon("chevron")}</button><button data-go="review"><span class="log-icon">${icon("calendar")}</span><div><strong>Footwork with a pause</strong><small>Yesterday · 12 reps · 6 min</small></div>${icon("chevron")}</button></div>`;
}
function coach() {
  return `${heading("SESSION COACH", "Let’s work on it.")}<div class="coach-context">${photo("", "")}<div><span>CURRENT REPLAY</span><strong>Lunge & recovery</strong><small>Rep ${selectedRep + 1} · ${reps[selectedRep].time.toFixed(2)}s recovery</small></div><button class="icon-button" data-go="review" aria-label="Back to replay">${icon("chevron")}</button></div><div class="coach-conversation"><div class="chat-message coach"><span class="coach-emblem">${icon("spark")}</span><div><p>${cueBody()}</p><p>What would you like to look at together?</p></div></div>${messages.map((m) => `<div class="chat-message ${m.role}">${m.role === "coach" ? '<span class="coach-emblem">' + icon("spark") + "</span>" : ""}<div><p>${e(m.text)}</p>${m.source ? '<button class="chat-source" data-go="review">View session evidence ' + icon("arrow") + "</button>" : ""}</div></div>`).join("")}</div><div class="coach-prompts"><button data-prompt="What changed from my baseline?">Compare with baseline</button><button data-prompt="Give me one drill for next time.">One drill for next time</button></div><form id="chat-form"><label for="chat-question" class="sr-only">Ask about your session</label><input id="chat-question" maxlength="250" required placeholder="Ask about your session…"><button type="submit" aria-label="Send question">${icon("arrow")}</button></form><p class="subtle-note">Prototype conversation · illustrative responses.</p>`;
}
function render(preserveScroll = false) {
  const scrollPosition = $("app-scroll").scrollTop;
  const meta = screenMeta[activeScreen];
  $("phone").className = "phone-frame " + concept;
  $("direction-title").innerHTML =
    `<span>${e(concepts[concept].tag)}</span>${e(concepts[concept].title)}`;
  $("direction-description").textContent = concepts[concept].description;
  $("direction-points").innerHTML = concepts[concept].points
    .map(
      (point, i) =>
        `<div class="direction-point"><span>0${i + 1}</span><p>${e(point)}</p></div>`,
    )
    .join("");
  $("screen-name").textContent = meta[0];
  $("screen-purpose").textContent = meta[1];
  $("screen-number").textContent =
    `0${Math.max(0, ["home", "record", "review", "progress", "coach"].indexOf(activeScreen)) + 1} / 05`;
  $("flow-buttons").innerHTML = [
    "home",
    "record",
    "review",
    "progress",
    "coach",
  ]
    .map(
      (name, i) =>
        `<button data-go="${name}" class="${name === activeScreen ? "active" : ""}"><span>0${i + 1}</span>${screenMeta[name][0]}${icon("chevron")}</button>`,
    )
    .join("");
  document
    .querySelectorAll("[data-concept]")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.concept === concept),
      ),
    );
  $("screen").innerHTML = { home, record, review, progress, coach, drill }[
    activeScreen
  ]();
  $("app-nav").innerHTML = [
    ["home", "target", "Train"],
    ["review", "play", "Review"],
    ["record", "camera", "Record"],
    ["progress", "chart", "Progress"],
    ["coach", "chat", "Coach"],
  ]
    .map(
      ([name, symbol, label]) =>
        `<button data-go="${name}" class="${activeScreen === name || (name === "home" && activeScreen === "drill") ? "active" : ""} ${name === "record" ? "record-nav" : ""}" aria-label="${label}" ${activeScreen === name ? 'aria-current="page"' : ""}>${icon(symbol)}<span>${label}</span></button>`,
    )
    .join("");
  $("full-preview").href = `?concept=${concept}&screen=${activeScreen}&focus=1`;
  const next = new URL(location.href);
  next.searchParams.set("concept", concept);
  next.searchParams.set("screen", activeScreen);
  history.replaceState({}, "", next);
  $("app-scroll").scrollTop = preserveScroll ? scrollPosition : 0;
}
function go(name) {
  if (recording) stopRecording();
  if (playing) stopPlayback();
  activeScreen = name;
  render();
}
function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 2600);
}
function stopRecording() {
  clearInterval(timer);
  timer = null;
  recording = false;
}
function stopPlayback() {
  clearInterval(playback);
  playback = null;
  playing = false;
}
function answer(question) {
  const text = question.toLowerCase(),
    rep = reps[selectedRep];
  if (/confidence|quality|tracking/.test(text))
    return `This sample rep has ${Math.round(rep.quality * 100)}% supplied tracking confidence. ${rep.quality < 0.65 ? "That is below the prototype threshold: review the footage or record again before making a technique correction." : "That still does not independently establish the accuracy of the measurement. Check the clip and event labels."}`;
  if (/baseline|compare|change|faster/.test(text))
    return `The supplied baseline is 1.10s. Rep ${selectedRep + 1} records ${rep.time.toFixed(2)}s, a change of ${(rep.time - 1.1).toFixed(2)}s. A shorter interval does not prove better balance; review how the return to en garde looks.`;
  if (/drill|next|practice/.test(text))
    return "Try five slow lunges with deliberate recovery to en garde, followed by five at normal practice speed. Rest between sets. Ask your coach which repetitions stay controlled.";
  return "For this prototype, I can show a baseline comparison, tracking-confidence explanation, or one practice drill. Select one below to explore a grounded coaching conversation.";
}
document.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.concept) {
    stopRecording();
    stopPlayback();
    concept = button.dataset.concept;
    activeScreen = concepts[concept].defaultScreen;
    render();
  } else if (button.hasAttribute("data-open-drill")) {
    selectedDrill = Number(button.dataset.openDrill);
    go("drill");
  } else if (button.dataset.go) go(button.dataset.go);
  else if (button.hasAttribute("data-save")) {
    saved = !saved;
    render();
    toast(
      saved
        ? "Drill saved to your practice list."
        : "Drill removed from saved practice.",
    );
  } else if (button.hasAttribute("data-start-recording")) {
    if (document.querySelector(".setup-checks input:not(:checked)")) {
      toast("Check your framing, fixed camera and space before starting.");
      return;
    }
    recording = true;
    elapsed = 0;
    render();
    timer = setInterval(() => {
      elapsed++;
      if ($("record-clock")) $("record-clock").textContent = clock(elapsed);
    }, 1000);
  } else if (button.hasAttribute("data-finish-recording")) {
    stopRecording();
    selectedRep = 3;
    go("review");
    toast("Sample session ready to review.");
  } else if (button.hasAttribute("data-toggle-overlay")) {
    overlay = !overlay;
    render(true);
  } else if (button.hasAttribute("data-rep")) {
    stopPlayback();
    selectedRep = Number(button.dataset.rep);
    render(true);
  } else if (button.hasAttribute("data-play")) {
    playing = !playing;
    if (!playing) {
      stopPlayback();
      render();
    } else {
      render();
      playback = setInterval(() => {
        selectedRep = (selectedRep + 1) % reps.length;
        render(true);
      }, 1800);
    }
  } else if (button.dataset.range) {
    progressRange = button.dataset.range;
    render();
  } else if (button.dataset.prompt) {
    messages.push(
      { role: "user", text: button.dataset.prompt },
      { role: "coach", text: answer(button.dataset.prompt), source: true },
    );
    render();
    $("app-scroll").scrollTop = $("app-scroll").scrollHeight;
  } else if (button.dataset.toast) toast(button.dataset.toast);
});
document.addEventListener("change", (event) => {
  if (event.target.id === "rep-slider") {
    stopPlayback();
    selectedRep = Number(event.target.value);
    render(true);
  }
});
document.addEventListener("submit", (event) => {
  if (event.target.id !== "chat-form") return;
  event.preventDefault();
  const question = $("chat-question").value.trim();
  if (!question) return;
  messages.push(
    { role: "user", text: question },
    { role: "coach", text: answer(question), source: true },
  );
  render();
  $("app-scroll").scrollTop = $("app-scroll").scrollHeight;
});
render();
