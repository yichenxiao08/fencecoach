import { api } from "./api-client.js";
const $ = (id) => document.getElementById(id);
const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let inventory,
  current,
  labels,
  selection = 0,
  dirty = false,
  saving = false;
const pretty = (s) => String(s).replaceAll("_", " ");
const base = () => `/api/datasets/${current.collection}/${current.clip_id}`;
function status(message) {
  $("dataset-status").textContent = message;
}
function renderSources() {
  const query = $("source-filter").value.toLowerCase();
  $("source-list").innerHTML = inventory.clips
    .filter((c) =>
      `${c.clip_id} ${c.teaching_topic} ${c.description || ""}`
        .toLowerCase()
        .includes(query),
    )
    .map(
      (c) =>
        `<button class="dataset-source ${current?.clip_id === c.clip_id ? "active" : ""}" data-collection="${escape(c.collection)}" data-clip="${escape(c.clip_id)}">${escape(pretty(c.clip_id))}<small>${escape(c.collection)} · ${(c.duration_ms / 1000).toFixed(1)} s · ${escape(c.license)}</small><small>${c.annotation_counts.provisional || 0} drafts / ${c.annotation_counts.reviewed || 0} reviewed</small></button>`,
    )
    .join("");
}
function renderSegments() {
  $("segment-list").innerHTML =
    labels.segments
      .map(
        (s, i) =>
          `<div class="dataset-segment"><strong>${escape(pretty(s.label))} · ${(s.start_ms / 1000).toFixed(3)}–${(s.end_ms / 1000).toFixed(3)} s</strong><p>${escape(s.layer)} / ${escape(s.track_id)} · ${escape(s.status)} · ${escape(s.origin)} · boundary ±${s.boundary_uncertainty_ms} ms</p><p>${escape(s.note)}</p><button data-seek="${s.start_ms}">View</button><button data-edit="${i}">Edit</button><button data-confirm="${i}">Confirm label</button><button data-reject="${i}">Reject</button><button data-remove="${i}">Remove</button></div>`,
      )
      .join("") || "<p>No timestamped labels yet.</p>";
}
function movementOptions() {
  const layer = $("segment-form").elements.layer.value;
  $("segment-form").elements.label.innerHTML = inventory.ontology[layer]
    .map((l) => `<option value="${l}">${escape(pretty(l))}</option>`)
    .join("");
}
async function openClip(collection, id) {
  if (saving || dirty) {
    status("Save the current review before changing source clips.");
    return;
  }
  const request = ++selection;
  const clip = inventory.clips.find(
    (c) => c.collection === collection && c.clip_id === id,
  );
  const marked = await api(`/api/datasets/${collection}/${id}/labels`);
  if (request !== selection) return;
  current = clip;
  labels = marked;
  $("dataset-review").hidden = false;
  $("clip-title").textContent = pretty(id);
  const video = $("dataset-video");
  video.src = `${base()}/source`;
  video.playbackRate = Number($("playback-speed").value);
  $("source-credit").innerHTML =
    `${escape(current.attribution)} · <a href="${escape(current.source_page)}" target="_blank" rel="noreferrer">Source</a> · <a href="${escape(current.license_url)}" target="_blank" rel="noreferrer">${escape(current.license)}</a>`;
  $("source-context").textContent =
    `${current.description || pretty(current.teaching_topic)}. Split group: ${current.split_group}. ${current.commercial_use ? "" : "Noncommercial development use only."}`;
  $("reviewer").value =
    labels.reviewer_role === "assistant"
      ? ""
      : labels.reviewer === "unreviewed"
        ? ""
        : labels.reviewer;
  $("reviewer-role").value =
    labels.reviewer_role === "coach" ? "coach" : "athlete";
  $("track-description").value = labels.track_description;
  $("weapon").value = labels.weapon;
  $("facing").value = labels.facing;
  $("opponent-visible").checked = labels.opponent_visible;
  for (const key of ["x", "y", "width", "height"])
    $(`crop-${key}`).value = labels.crop[key];
  renderSources();
  renderSegments();
  movementOptions();
  $("segment-form").reset();
  delete $("segment-form").dataset.editIndex;
  movementOptions();
  status(
    `${inventory.clips.length} collected clips. This source has ${labels.segments.length} draft/reviewed intervals.`,
  );
}
$("source-filter").addEventListener("input", renderSources);
$("source-list").addEventListener("click", (e) => {
  const b = e.target.closest("[data-clip]");
  if (b)
    openClip(b.dataset.collection, b.dataset.clip).catch((e) =>
      status(e.message),
    );
});
const video = $("dataset-video");
video.addEventListener(
  "timeupdate",
  () => ($("video-time").textContent = `${video.currentTime.toFixed(3)} s`),
);
$("playback-speed").addEventListener(
  "change",
  () => (video.playbackRate = Number($("playback-speed").value)),
);
for (const [id, sign] of [
  ["step-back", -1],
  ["step-forward", 1],
])
  $(id).addEventListener("click", () => {
    video.pause();
    video.currentTime = Math.max(
      0,
      Math.min(video.duration, video.currentTime + sign / current.fps),
    );
  });
$("segment-form").elements.layer.addEventListener("change", movementOptions);
$("dataset-review").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.mark) {
    $("segment-form").elements[b.dataset.mark].value =
      video.currentTime.toFixed(3);
    return;
  }
  if (b.dataset.seek !== undefined) {
    video.pause();
    video.currentTime = Number(b.dataset.seek) / 1000;
    return;
  }
  if (b.dataset.remove !== undefined) {
    labels.segments.splice(Number(b.dataset.remove), 1);
    dirty = true;
  }
  if (b.dataset.reject !== undefined) {
    labels.segments[Number(b.dataset.reject)].status = "rejected";
    dirty = true;
  }
  if (b.dataset.confirm !== undefined) {
    if (!$("reviewer").value.trim()) {
      status("Enter the human reviewer name before confirming a label.");
      return;
    }
    const s = labels.segments[Number(b.dataset.confirm)];
    if (
      s.layer === "tactics" &&
      ($("reviewer-role").value !== "coach" || !$("opponent-visible").checked)
    ) {
      status("Tactical labels require coach review and opponent context.");
      return;
    }
    s.status = "reviewed";
    dirty = true;
  }
  if (b.dataset.edit !== undefined) {
    const s = labels.segments[Number(b.dataset.edit)],
      f = $("segment-form");
    f.elements.start.value = s.start_ms / 1000;
    f.elements.end.value = s.end_ms / 1000;
    f.elements.layer.value = s.layer;
    movementOptions();
    f.elements.label.value = s.label;
    f.elements.track.value = s.track_id;
    f.elements.note.value = s.note;
    f.dataset.editIndex = b.dataset.edit;
    status("Edit the interval below, then save the review.");
  }
  renderSegments();
});
$("segment-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target,
    d = new FormData(f);
  const segment = {
    start_ms: Math.round(Number(d.get("start")) * 1000),
    end_ms: Math.round(Number(d.get("end")) * 1000),
    layer: d.get("layer"),
    label: d.get("label"),
    track_id: d.get("track"),
    note: d.get("note"),
    origin: "human",
    status: "provisional",
    confidence: "medium",
    boundary_uncertainty_ms: 250,
  };
  if (
    segment.end_ms <= segment.start_ms ||
    segment.end_ms > current.duration_ms
  ) {
    status("Choose an interval inside the source video.");
    return;
  }
  if (f.dataset.editIndex !== undefined) {
    labels.segments[Number(f.dataset.editIndex)] = segment;
    delete f.dataset.editIndex;
  } else labels.segments.push(segment);
  dirty = true;
  renderSegments();
  f.reset();
  movementOptions();
  status("Label changed locally. Save review to persist it.");
});
for (const id of [
  "reviewer",
  "reviewer-role",
  "track-description",
  "weapon",
  "facing",
  "opponent-visible",
  "crop-x",
  "crop-y",
  "crop-width",
  "crop-height",
])
  $(id).addEventListener("input", () => {
    dirty = true;
  });
window.addEventListener("beforeunload", (event) => {
  if (dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});
function currentAnnotations() {
  return {
    ...labels,
    reviewer: $("reviewer").value.trim() || "unreviewed",
    reviewer_role: $("reviewer-role").value,
    track_description: $("track-description").value,
    weapon: $("weapon").value,
    facing: $("facing").value,
    opponent_visible: $("opponent-visible").checked,
    crop: Object.fromEntries(
      ["x", "y", "width", "height"].map((k) => [
        k,
        Number($(`crop-${k}`).value),
      ]),
    ),
  };
}
$("save-labels").addEventListener("click", async () => {
  const b = $("save-labels");
  b.disabled = true;
  saving = true;
  $("dataset-review").inert = true;
  try {
    labels = await api(`${base()}/labels`, {
      method: "PUT",
      body: JSON.stringify(currentAnnotations()),
    });
    dirty = false;
    inventory = await api("/api/datasets");
    renderSources();
    renderSegments();
    status("Saved with provenance and review history.");
  } catch (e) {
    status(e.message);
  } finally {
    b.disabled = false;
    saving = false;
    $("dataset-review").inert = false;
  }
});
$("export-labels").addEventListener("click", () => {
  const blob = new Blob(
      [
        JSON.stringify(
          { source: current, annotations: currentAnnotations() },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    ),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = `${current.clip_id}-labels.json`;
  a.click();
  URL.revokeObjectURL(url);
});
try {
  inventory = await api("/api/datasets");
  renderSources();
  status(
    `${inventory.clips.length} source videos collected. ${inventory.annotation_counts.provisional || 0} provisional labels; ${inventory.annotation_counts.reviewed || 0} reviewed.`,
  );
  if (inventory.clips.length) {
    const first =
      inventory.clips.find((c) => c.clip_id === "jumpe_lunge") ||
      inventory.clips[0];
    await openClip(first.collection, first.clip_id);
  }
} catch (e) {
  status(e.message);
}
