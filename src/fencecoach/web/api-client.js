export async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  if (response.status === 204 && response.ok) return null;
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      "The server returned an unreadable response. Please try again.",
    );
  }
  if (!response.ok) {
    let message = data.detail || "We couldn’t complete that request.";
    if (Array.isArray(message))
      message = message
        .map((issue) => `${issue.loc.slice(1).join(".")}: ${issue.msg}`)
        .join(" · ");
    throw new Error(message);
  }
  return data;
}
export const sessionPath = (id) => `/api/sessions/${encodeURIComponent(id)}`;
export function downloadJSON(data, name) {
  downloadBlob(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    name,
  );
}
export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
