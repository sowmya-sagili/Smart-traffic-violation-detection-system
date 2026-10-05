/**
 * detection.js
 * In Phase 0, vehicle tracking, bounding boxes, and violation detection
 * are rendered server-side directly into the processed video stream.
 * Client-side simulation has been removed.
 */

export function setupCanvasOverlay(video) {
  const canvas = document.getElementById("canvas-overlay");
  if (!canvas || !video) return;

  video.addEventListener("loadedmetadata", () => {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  });
}