// Clips remain on this device. JSON measurements and coaching stay on the API.
const MAX_CLIP_BYTES = 200 * 1024 * 1024;
let database,
  stream = null,
  recorder = null,
  chunks = [],
  startedAt = 0,
  recordTimer = null,
  stopResolve,
  stopReject;
let clipURL = null,
  currentClip = null;
export const capture = { ready: false, recording: false, elapsed: 0 };
async function db() {
  if (!database)
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open("fencecoach-media", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("clips");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        database = null;
        reject(
          new Error(
            "Clip storage isn’t available in this browser. You can still download your video.",
          ),
        );
      };
      request.onblocked = () =>
        reject(
          new Error("Close other FenceCoach tabs before opening clip storage."),
        );
    });
  return database;
}
export async function saveClip(id, blob) {
  if (blob.size > MAX_CLIP_BYTES)
    throw new Error("Choose a video smaller than 200 MB.");
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction("clips", "readwrite");
    tx.objectStore("clips").put(blob, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(
        new Error(
          "Your session was saved, but this browser couldn’t store the video. Download it before leaving.",
        ),
      );
  });
}
export async function loadClip(id) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database.transaction("clips").objectStore("clips").get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () =>
      reject(new Error("Couldn’t open the video stored on this device."));
  });
}
export function setClip(blob) {
  if (clipURL) URL.revokeObjectURL(clipURL);
  currentClip = blob;
  clipURL = blob ? URL.createObjectURL(blob) : null;
}
export const getClipURL = () => clipURL;
export const getClip = () => currentClip;
export function validateClip(file) {
  if (!file.type.startsWith("video/"))
    throw new Error("Choose a video file such as MP4 or WebM.");
  if (file.size > MAX_CLIP_BYTES)
    throw new Error("Choose a video smaller than 200 MB.");
  if (!file.size) throw new Error("This video file is empty.");
}
export async function openCamera() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
    throw new Error(
      "Camera recording isn’t supported here. Upload a clip instead, or use a browser with camera support.",
    );
  closeCamera();
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
    capture.ready = true;
  } catch {
    throw new Error(
      "Couldn’t open the camera. Allow camera access in your browser, or upload a clip instead.",
    );
  }
}
export function mountCamera(video) {
  if (video && stream) {
    video.srcObject = stream;
    video.play().catch(() => {});
  }
}
export function startRecording(onTick, onLimit, onError) {
  if (!stream) throw new Error("Enable the camera first.");
  chunks = [];
  const type = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/mp4",
  ].find((type) => MediaRecorder.isTypeSupported(type));
  recorder = new MediaRecorder(stream, type ? { mimeType: type } : {});
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: recorder.mimeType || "video/webm" });
    capture.recording = false;
    clearInterval(recordTimer);
    stopResolve?.(blob);
    stopResolve = null;
    stopReject = null;
  };
  recorder.onerror = () => {
    capture.recording = false;
    clearInterval(recordTimer);
    stopReject?.(
      new Error(
        "The camera recording was interrupted. Try uploading a recorded clip instead.",
      ),
    );
    stopResolve = null;
    stopReject = null;
    closeCamera();
    onError?.(
      "The camera recording was interrupted. Try uploading a recorded clip instead.",
    );
  };
  recorder.start(1000);
  capture.recording = true;
  capture.elapsed = 0;
  startedAt = Date.now();
  recordTimer = setInterval(() => {
    capture.elapsed = Math.floor((Date.now() - startedAt) / 1000);
    onTick(capture.elapsed);
    if (
      capture.elapsed >= 600 ||
      chunks.reduce((sum, chunk) => sum + chunk.size, 0) > MAX_CLIP_BYTES
    )
      onLimit();
  }, 1000);
}
export function finishRecording() {
  if (!recorder || recorder.state === "inactive")
    return Promise.reject(new Error("There’s no recording to finish."));
  return new Promise((resolve, reject) => {
    stopResolve = resolve;
    stopReject = reject;
    recorder.stop();
  });
}
export function closeCamera() {
  clearInterval(recordTimer);
  if (recorder?.state === "recording") recorder.stop();
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  capture.ready = false;
  capture.recording = false;
}
