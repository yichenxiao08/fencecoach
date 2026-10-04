import { e, icon, label } from "./ui.js";
import { api, downloadJSON } from "./api-client.js";

const names = {
  left_knee_angle: "Left knee",
  right_knee_angle: "Right knee",
  torso_tilt: "Torso tilt",
  left_elbow_angle: "Left elbow",
  right_elbow_angle: "Right elbow",
  left_arm_extension: "Left arm",
  right_arm_extension: "Right arm",
};
export function measurementCards(measurements = []) {
  return `<div class="motion-metrics">${measurements.map((m) => `<article><span>${e(label(m.name))}</span><strong>${Number(m.value).toFixed(m.unit === "deg" ? 1 : 2)}<small> ${e(m.unit)}</small></strong><small>${Math.round(m.confidence * 100)}% landmark quality${m.coverage != null ? ` · ${Math.round(m.coverage * 100)}% coverage` : ""}</small></article>`).join("")}</div>`;
}
function chart(result, view = "knees") {
  const keys =
    view === "arms"
      ? ["left_arm_extension", "right_arm_extension"]
      : view === "torso"
        ? ["torso_tilt"]
        : ["left_knee_angle", "right_knee_angle"];
  const high =
      view === "arms"
        ? 1
        : view === "torso"
          ? Math.max(
              30,
              Math.ceil(
                Math.max(
                  ...result.frames.map((f) => f.features?.torso_tilt || 0),
                ) / 15,
              ) * 15,
            )
          : 180,
    colors = ["var(--accent)", "#48bc93"];
  const paths = keys
    .map((key, i) => {
      let d = "",
        last = null;
      for (const frame of result.frames) {
        const value = frame.features?.[key];
        if (value == null) {
          last = null;
          continue;
        }
        d += `${last != null && frame.time_ms - last <= 300 ? "L" : "M"}${(48 + (frame.time_ms / result.duration_ms) * 596).toFixed(1)} ${(174 - (value / high) * 140).toFixed(1)} `;
        last = frame.time_ms;
      }
      return `<path d="${d}" stroke="${colors[i]}" stroke-width="2.5" fill="none"/>`;
    })
    .join("");
  return `<svg class="motion-chart" viewBox="0 0 680 210" role="img" aria-label="${e(view)} measurements over video time"><g stroke="var(--line)"><path d="M48 34H644M48 104H644M48 174H644"/></g><g fill="var(--muted)" font-size="12"><text x="6" y="38">${high}</text><text x="6" y="108">${high / 2}</text><text x="24" y="178">0</text><text x="48" y="202">0s</text><text x="598" y="202">${(result.duration_ms / 1000).toFixed(1)}s</text></g>${paths}</svg><p class="helper">${keys.map((k, i) => `<span style="color:${colors[i]}">${e(names[k])}</span>`).join(" · ")} · ${view === "arms" ? "extension ratio" : "degrees"}. Gaps indicate unavailable measurements.</p>`;
}
function gesturePredictions(result) {
  if (!result.gestures?.length) return "";
  return `<details class="disclosure"><summary>Model movement labels</summary><p class="helper">${e(result.gesture_model.version)} · Predictions need review. Model scores are not accuracy probabilities.</p>${result.gestures.map((gesture) => `<div class="annotation-row"><span>${e(label(gesture.label))} · ${(gesture.start_ms / 1000).toFixed(2)}–${(gesture.end_ms / 1000).toFixed(2)} s · Model score ${Math.round(gesture.model_score * 100)}%</span><button class="text-action" data-gesture-seek="${gesture.start_ms}">Watch ${icon("play")}</button></div>`).join("")}</details>`;
}
export function footworkPanel(result) {
  const summary = result.footwork_summary;
  if (!summary) return "";
  return `<details class="disclosure"><summary>Footwork & rhythm</summary><div class="motion-metrics"><article><span>Lower body visible</span><strong>${Math.round(summary.visible_fraction * 100)}%</strong><small>${summary.visible_frames} / ${summary.sampled_frames} samples; wrists are optional</small></article>${summary.stance_width_range ? `<article><span>Stance width range</span><strong>${summary.stance_width_range.map((v) => Number(v).toFixed(2)).join("–")}</strong><small>image-plane leg lengths</small></article>` : ""}</div>${summary.rhythm_intervals?.length ? summary.rhythm_intervals.map((r) => `<p>${(r.start_ms / 1000).toFixed(2)}–${(r.end_ms / 1000).toFixed(2)} s · ${r.cycles_per_minute} vertical cycles/min · ${Math.round(r.interval_variation * 100)}% interval variation</p>`).join("") : `<p>No sustained, regular vertical rhythm was found in the visible samples.</p>`}<p class="helper">Rhythm describes changes in hip height relative to the feet. It is a motion estimate, not a verified bounce count or a technique score.</p></details>`;
}
export function motionPanel(result) {
  if (!result.clip_measurements) return "";
  return `<section class="motion-panel"><div class="section-heading"><h2>Your movement, measured.</h2></div><div class="range-control"><button data-motion-view="knees" class="active">Knees</button><button data-motion-view="arms">Arm extension</button><button data-motion-view="torso">Torso</button></div><div id="motion-chart">${chart(result)}</div><details class="disclosure"><summary>Whole-clip measurements ${icon("chevron")}</summary>${measurementCards(result.clip_measurements)}${result.initial_guard_measurements?.length ? `<h3>Initial guard / first 1.5 seconds</h3>${measurementCards(result.initial_guard_measurements)}` : ""}<p class="helper">These summaries include all visible phases. They are not en-garde-specific or technique scores. Arm sides refer to anatomical left/right, not screen position. Torso tilt cannot measure spinal straightness.</p></details>${result.footwork_events?.length ? `<details class="disclosure"><summary>Footwork movement proposals</summary>${result.footwork_events.map((event) => `<p>${e(label(event.label))} · ${(event.start_ms / 1000).toFixed(2)}–${(event.end_ms / 1000).toFixed(2)} s</p>`).join("")}<p class="helper">Based on hip translation near the initial stance. Review each interval; these are heuristic proposals.</p></details>` : ""}${footworkPanel(result)}${gesturePredictions(result)}<details class="disclosure"><summary>Gesture labels & training data ${icon("chevron")}</summary><p class="helper">${result.gesture_model?.ready ? "A trained classifier is available. Review its labels; model scores are uncalibrated." : "Pose tracking uses a pretrained model. The fencing gesture classifier is not trained yet. Label movement intervals here to build the dataset."}</p><div id="gesture-labels"></div><form id="gesture-form"><label class="field"><span><input type="checkbox" name="domain_verified" id="gesture-domain" /> This clip shows modern sport fencing or a fencing footwork drill</span></label><div class="form-row"><label class="field"><span>Start / seconds</span><input name="start" type="number" min="0" max="${result.duration_ms / 1000}" step="0.001" value="0" required></label><label class="field"><span>End / seconds</span><input name="end" type="number" min="0.001" max="${result.duration_ms / 1000}" step="0.001" value="1" required></label></div><label class="field"><span>Movement you see</span><select name="label">${["en_garde", "advance", "retreat", "lunge", "recovery", "bounce", "jump_forward", "jump_back", "shuffle", "other"].map((v) => `<option value="${v}">${e(label(v))}</option>`).join("")}</select></label><button type="submit" class="secondary-action">Save gesture label ${icon("arrow")}</button></form><button class="text-action" data-dataset-export>Export labeled poses ${icon("arrow")}</button><p class="helper">Training splits by original video, so duplicate uploads cannot inflate the held-out score. More labeled clips and independent evaluation are needed before model promotion.</p></details></section>`;
}
export function repDetails(window, result) {
  const proposal = result.candidates.find(
    (c) => c.candidate_id === window.candidate_id,
  );
  if (
    !proposal?.measurements ||
    proposal.start_ms !== window.start_ms ||
    proposal.end_ms !== window.end_ms ||
    (window.onset_ms != null && proposal.onset_ms !== window.onset_ms)
  )
    return "";
  return `<details class="disclosure"><summary>Rep measurements ${icon("chevron")}</summary><p class="helper">Proposed movement onset ${(proposal.onset_ms / 1000).toFixed(3)} s. Review it against the footage.</p>${measurementCards(proposal.measurements)}</details>`;
}
function labelRows(labels) {
  return (
    labels
      .map(
        (l, i) =>
          `<div class="annotation-row"><span>${e(label(l.label))} · ${(l.start_ms / 1000).toFixed(2)}–${(l.end_ms / 1000).toFixed(2)} s</span><button class="text-action" data-label-remove="${i}">Remove</button></div>`,
      )
      .join("") || '<p class="empty-note">No human gesture labels saved.</p>'
  );
}
export function setupMotion({ state, notice }) {
  async function refresh() {
    const root = document.getElementById("gesture-labels");
    if (!root) return;
    state.annotations = await api(
      `/api/videos/${state.videoJob.job_id}/annotations`,
    );
    root.innerHTML = labelRows(state.annotations.labels);
    const domain = document.getElementById("gesture-domain");
    if (domain) domain.checked = Boolean(state.annotations.domain_verified);
  }
  return {
    mount: () => refresh().catch((error) => notice(error.message)),
    setup() {
      document.addEventListener("click", async (event) => {
        const b = event.target.closest("button");
        if (!b || b.disabled) return;
        try {
          if (b.hasAttribute("data-gesture-seek")) {
            const video = document.getElementById("analysis-video");
            video.currentTime = Number(b.dataset.gestureSeek) / 1000;
            video.play().catch(() => {});
          } else if (b.dataset.motionView) {
            document.getElementById("motion-chart").innerHTML = chart(
              state.videoResult,
              b.dataset.motionView,
            );
            b.parentElement
              .querySelectorAll("button")
              .forEach((button) =>
                button.classList.toggle("active", button === b),
              );
          } else if (b.hasAttribute("data-dataset-export")) {
            downloadJSON(
              await api(`/api/videos/${state.videoJob.job_id}/dataset`),
              `fencecoach-labeled-${state.videoJob.job_id}.json`,
            );
          } else if (b.hasAttribute("data-label-remove")) {
            b.disabled = true;
            const labels = state.annotations.labels.filter(
              (_, i) => i !== Number(b.dataset.labelRemove),
            );
            await api(`/api/videos/${state.videoJob.job_id}/annotations`, {
              method: "PUT",
              body: JSON.stringify({ ...state.annotations, labels }),
            });
            await refresh();
          }
        } catch (error) {
          notice(error.message);
          b.disabled = false;
        }
      });
      document.addEventListener("submit", async (event) => {
        if (event.target.id !== "gesture-form") return;
        event.preventDefault();
        const form = event.target,
          data = new FormData(form),
          button = form.querySelector("button");
        button.disabled = true;
        try {
          const labels = [
            ...(state.annotations?.labels || []),
            {
              start_ms: Math.round(Number(data.get("start")) * 1000),
              end_ms: Math.round(Number(data.get("end")) * 1000),
              label: data.get("label"),
            },
          ];
          await api(`/api/videos/${state.videoJob.job_id}/annotations`, {
            method: "PUT",
            body: JSON.stringify({
              ...state.annotations,
              labels,
              reviewer: "athlete",
              domain_verified: data.get("domain_verified") === "on",
            }),
          });
          await refresh();
        } catch (error) {
          notice(error.message);
        } finally {
          button.disabled = false;
        }
      });
    },
  };
}
