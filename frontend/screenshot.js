export function takeScreenshot(video, overlayCanvas) {
  const temp = document.createElement("canvas");
  temp.width = video.videoWidth;
  temp.height = video.videoHeight;

  const tctx = temp.getContext("2d");
  tctx.drawImage(video, 0, 0, temp.width, temp.height);
  tctx.drawImage(overlayCanvas, 0, 0);

  return temp.toDataURL("image/png");
}