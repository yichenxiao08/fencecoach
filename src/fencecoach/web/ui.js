export const $ = (id) => document.getElementById(id);
export const e = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        ch
      ],
  );
export const pretty = (value) =>
  Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 });
export const date = (value, long = false) =>
  new Date(value).toLocaleDateString(undefined, {
    month: long ? "long" : "short",
    day: "numeric",
    ...(long ? { weekday: "long" } : {}),
  });
export const clock = (seconds) =>
  `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
export const label = (name) => name.replaceAll("_", " ");
const paths = {
  target:
    '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>',
  camera: '<path d="M4 6h4l2-3h4l2 3h4v14H4Z"/><circle cx="12" cy="12" r="4"/>',
  chart: '<path d="M4 3v17h17M8 15l4-6 4 3 5-7"/>',
  chat: '<path d="M3 4h18v13H9l-6 4Z"/><path d="M7 9h10M7 13h7"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  back: '<path d="m14 5-7 7 7 7"/>',
  play: '<path d="m9 5 11 7-11 7Z"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/>',
  streak:
    '<path d="M13 3c2 6 7 8 6 13a7 7 0 0 1-14 0c-1-3 1-6 3-8 0 3 1 4 2 4 1-2 3-5 3-9Z"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  flag: '<path d="M5 22V3h14l-3 4 3 4H5"/>',
  calendar: '<path d="M4 5h16v16H4ZM4 10h16M8 2v6m8-6v6"/>',
  spark: '<path d="m12 3 3 6 6 3-6 3-3 6-3-6-6-3 6-3Z"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/>',
  settings:
    '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
};
export const icon = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.target}</svg>`;
export const primary = (text, attrs = "") =>
  `<button class="primary-action" ${attrs}>${e(text)} ${icon("arrow")}</button>`;
export const secondary = (text, attrs = "") =>
  `<button class="secondary-action" ${attrs}>${e(text)} ${icon("chevron")}</button>`;
export const heading = (kicker, title, extra = "") =>
  `<div class="page-heading"><div><p class="eyebrow">${e(kicker)}</p><h1>${title}</h1></div>${extra}</div>`;
export const photo = (cls = "", content = "") =>
  `<div class="photo ${cls}"><img src="/static/fencing-editorial.png" alt="Illustrative photograph of a foil fencer lunging in a training salle" />${content}</div>`;
export function groups(metrics = []) {
  const result = new Map();
  for (const metric of metrics) {
    const key = JSON.stringify([metric.name, metric.unit]);
    if (!result.has(key)) result.set(key, []);
    result.get(key).push(metric);
  }
  return [...result.values()].sort((a, b) => b.length - a.length);
}
export const mean = (metrics) =>
  metrics.reduce((sum, m) => sum + m.value, 0) / metrics.length;
export function displayMetric(metric) {
  return metric.unit === "ms"
    ? { value: pretty(metric.value / 1000), unit: "s" }
    : { value: pretty(metric.value), unit: metric.unit };
}
export function dayKey(value) {
  const dt = new Date(value);
  return `${dt.getFullYear()}-${dt.getMonth() + 1}-${dt.getDate()}`;
}
export function periodStart(range) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  if (range === "month") now.setDate(1);
  else now.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  return now;
}
export function practiceStats(sessions) {
  const real = sessions.filter((s) => !s.is_demo),
    week = real.filter((s) => new Date(s.created_at) >= periodStart("week"));
  const days = new Set(real.map((s) => dayKey(s.created_at)));
  let streak = 0;
  const cursor = new Date();
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (days.has(dayKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return { real, week, streak };
}
export function trendChart(points, unit) {
  if (points.length < 2)
    return '<p class="empty-note">Add another practice session with the same measurement and unit to see a trend.</p>';
  const values = points.map((p) => p.value),
    min = Math.min(...values),
    max = Math.max(...values),
    padding = (max - min) * 0.2 || Math.abs(max) * 0.1 || 1;
  const low = min - padding,
    high = max + padding,
    coords = values.map((v, i) => [
      48 + (i * 496) / (values.length - 1),
      135 - ((v - low) / (high - low)) * 105,
    ]);
  return `<svg class="trend-chart" viewBox="0 0 570 180" role="img" aria-label="Session means for the same measurement and unit"><g stroke="var(--line)"><path d="M48 30H544M48 83H544M48 135H544"/></g><g fill="var(--muted)" font-size="11"><text x="0" y="34">${e(pretty(high))}</text><text x="0" y="88">${e(pretty((low + high) / 2))}</text><text x="0" y="139">${e(pretty(low))}</text><text x="48" y="167">${e(date(points[0].created_at))}</text><text x="500" y="167">${e(date(points.at(-1).created_at))}</text></g><polyline points="${coords.map((p) => p.join(",")).join(" ")}" fill="none" stroke="var(--accent)" stroke-width="3"/>${coords.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="5" fill="var(--accent)"><title>${e(date(points[i].created_at))}: ${e(pretty(values[i]))} ${e(unit)}</title></circle>`).join("")}</svg>`;
}
