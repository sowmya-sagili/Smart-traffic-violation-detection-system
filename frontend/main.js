import {
  API_BASE,
  getHealth,
  getConfig,
  getViolations,
  getViolation,
  approveViolation,
  rejectViolation,
  getHistory,
  saveCalibration,
  getCalibration
} from "./data.js";

// Application State
let currentView = "home"; // "home" | "module" | "history"
let currentAnalysisMode = "RED_SIGNAL"; // "RED_SIGNAL" | "SPEED" | "NO_HELMET"
let activeHistoryTab = "RED_SIGNAL"; // "RED_SIGNAL" | "SPEED" | "NO_HELMET"
let selectedFile = null;
let currentVideoId = null;
let pollInterval = null;
let roadConfigCache = null;
let isResultVideoLoaded = false;

// Active per-video calibration in ORIGINAL VIDEO PIXELS
let activeCalibration = {
  stop_line: null,         // [[x1, y1], [x2, y2]]
  traffic_light_roi: null, // [[rx1, ry1], [rx2, ry2]]
  traffic_light_mode: "red"
};

// Active per-video speed calibration in ORIGINAL VIDEO PIXELS
let activeSpeedCalibration = {
  line_a: null,           // [[x1, y1], [x2, y2]]
  line_b: null,           // [[x1, y1], [x2, y2]]
  distance_meters: 10.0,
  speed_limit_kmh: 60.0
};
let speedLinePoint1 = null; // [x, y] original coords for Line A or Line B first point

// Interactive drawing states
// null | "DRAW_LINE_P1" | "DRAW_LINE_P2" | "DRAW_ROI_READY" | "DRAW_ROI_DRAGGING" | "DRAW_SPEED_LINE_A_P1" | "DRAW_SPEED_LINE_A_P2" | "DRAW_SPEED_LINE_B_P1" | "DRAW_SPEED_LINE_B_P2"
let calibrationTool = null;
let linePointA = null; // [x, y] original coords
let roiDragStart = null; // [x, y] original coords
let roiDragCurrent = null; // [x, y] original coords
let currentMousePosCanvas = null; // {x, y} canvas coords

// DOM Element References
const homeView = document.getElementById("home-view");
const moduleView = document.getElementById("module-view");
const historyView = document.getElementById("history-view");

const navBtnHome = document.getElementById("nav-btn-home");
const navBtnHistory = document.getElementById("nav-btn-history");

const fileInput = document.getElementById("file-input");
const dropZone = document.getElementById("drop-zone");
const videoWorkspaceBox = document.getElementById("video-workspace-box");
const videoPreviewWrapper = document.getElementById("video-preview-wrapper");
const videoCanvasWrapper = document.getElementById("video-canvas-wrapper");
const videoOverlayCanvas = document.getElementById("video-overlay-canvas");
const redSignalCalibrationPanel = document.getElementById("red-signal-calibration-panel");
const btnDrawStopLine = document.getElementById("btn-draw-stop-line");
const btnDrawTrafficRoi = document.getElementById("btn-draw-traffic-roi");
const btnResetCalibration = document.getElementById("btn-reset-calibration");
const calibGuideText = document.getElementById("calib-guide-text");
const statusStopLineVal = document.getElementById("status-stop-line-val");
const statusRoiVal = document.getElementById("status-roi-val");
const redSignalCalibChecklist = document.getElementById("red-signal-calib-checklist");
const chkStopLine = document.getElementById("chk-stop-line");
const chkTrafficRoi = document.getElementById("chk-traffic-roi");

const speedCalibrationPanel = document.getElementById("speed-calibration-panel");
const btnDrawSpeedLineA = document.getElementById("btn-draw-speed-line-a");
const btnDrawSpeedLineB = document.getElementById("btn-draw-speed-line-b");
const btnResetSpeedCalibration = document.getElementById("btn-reset-speed-calibration");
const speedCalibGuideText = document.getElementById("speed-calib-guide-text");
const speedDistanceInput = document.getElementById("speed-distance-input");
const speedLimitInput = document.getElementById("speed-limit-input");
const statusLineAVal = document.getElementById("status-line-a-val");
const statusLineBVal = document.getElementById("status-line-b-val");
const speedCalibChecklist = document.getElementById("speed-calib-checklist");
const chkLineA = document.getElementById("chk-line-a");
const chkLineB = document.getElementById("chk-line-b");
const chkDistance = document.getElementById("chk-distance");
const chkSpeedLimit = document.getElementById("chk-speed-limit");

const videoStatusIndicator = document.getElementById("video-status-indicator");
const videoMetaTag = document.getElementById("video-meta-tag");
const changeVideoBtn = document.getElementById("change-video-btn");
const loadSampleBtn = document.getElementById("load-sample-btn");
const sampleBtnText = document.getElementById("sample-btn-text");

const startBtn = document.getElementById("start-detection-btn");
const selectedFileNameEl = document.getElementById("selected-file-name");
const selectedFileSizeEl = document.getElementById("selected-file-size");
const uploadStatusEl = document.getElementById("upload-status");

const processingBox = document.getElementById("processing-box");
const progressBarFill = document.getElementById("progress-bar-fill");
const progressPercentageLabel = document.getElementById("progress-percentage-label");
const processingStatusDetail = document.getElementById("processing-status-detail");

const moduleVideoPlayer = document.getElementById("module-video-player");

const detectedViolationsSection = document.getElementById("detected-violations-section");
const violationsCardsContainer = document.getElementById("violations-cards-container");
const violationsCountTag = document.getElementById("violations-count-tag");
const violationsHeaderTitle = document.getElementById("violations-header-title");

const historyListContainer = document.getElementById("history-list-container");

// =====================================================================
// Top-Level View Switching
// =====================================================================

export function showView(viewName) {
  currentView = viewName;

  // Toggle Section Visibilities
  if (homeView) homeView.classList.toggle("hidden", viewName !== "home");
  if (moduleView) moduleView.classList.toggle("hidden", viewName !== "module");
  if (historyView) historyView.classList.toggle("hidden", viewName !== "history");

  // Update Top Navigation Button Highlights
  if (navBtnHome) {
    if (viewName === "home") {
      navBtnHome.className = "px-5 py-2 rounded-xl text-xs sm:text-sm font-bold tracking-wide transition flex items-center gap-2 cursor-pointer bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 shadow-lg shadow-cyan-500/10";
    } else {
      navBtnHome.className = "px-5 py-2 rounded-xl text-xs sm:text-sm font-bold tracking-wide transition flex items-center gap-2 cursor-pointer glass text-slate-300 hover:text-white border border-white/10 hover:border-cyan-400/40";
    }
  }

  if (navBtnHistory) {
    if (viewName === "history") {
      navBtnHistory.className = "px-5 py-2 rounded-xl text-xs sm:text-sm font-bold tracking-wide transition flex items-center gap-2 cursor-pointer bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 shadow-lg shadow-cyan-500/10";
    } else {
      navBtnHistory.className = "px-5 py-2 rounded-xl text-xs sm:text-sm font-bold tracking-wide transition flex items-center gap-2 cursor-pointer glass text-slate-300 hover:text-white border border-white/10 hover:border-cyan-400/40";
    }
  }

  if (viewName === "history") {
    loadHistoryData(activeHistoryTab);
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}
window.showView = showView;

// =====================================================================
// RED SIGNAL Live Overlay: Stop Line & Traffic Light ROI
// =====================================================================

function parsePoint(pt) {
  if (Array.isArray(pt)) {
    return [parseFloat(pt[0]) || 0, parseFloat(pt[1]) || 0];
  }
  if (typeof pt === "string") {
    const parts = pt.trim().split(/\s+/);
    return [parseFloat(parts[0]) || 0, parseFloat(parts[1]) || 0];
  }
  return [0, 0];
}

function getRenderedVideoGeometry(video, canvas) {
  if (!video || !canvas || !video.videoWidth || !video.videoHeight) return null;

  const cWidth = canvas.clientWidth;
  const cHeight = canvas.clientHeight;
  if (!cWidth || !cHeight) return null;

  if (canvas.width !== cWidth || canvas.height !== cHeight) {
    canvas.width = cWidth;
    canvas.height = cHeight;
  }

  const vidAspect = video.videoWidth / video.videoHeight;
  const elemAspect = cWidth / cHeight;

  let renderW, renderH, offsetX, offsetY;

  if (vidAspect > elemAspect) {
    // Letterbox: black bars top and bottom
    renderW = cWidth;
    renderH = cWidth / vidAspect;
    offsetX = 0;
    offsetY = (cHeight - renderH) / 2;
  } else {
    // Pillarbox: black bars left and right
    renderH = cHeight;
    renderW = cHeight * vidAspect;
    offsetX = (cWidth - renderW) / 2;
    offsetY = 0;
  }

  const scale = renderW / video.videoWidth;

  return {
    scale,
    offsetX,
    offsetY,
    renderW,
    renderH,
    vidW: video.videoWidth,
    vidH: video.videoHeight,
    canvasW: cWidth,
    canvasH: cHeight
  };
}

export function canvasToOriginalCoords(canvasX, canvasY, geom) {
  if (!geom || geom.scale <= 0) return [0, 0];
  const clampedX = Math.max(geom.offsetX, Math.min(geom.offsetX + geom.renderW, canvasX));
  const clampedY = Math.max(geom.offsetY, Math.min(geom.offsetY + geom.renderH, canvasY));
  const origX = Math.round((clampedX - geom.offsetX) / geom.scale);
  const origY = Math.round((clampedY - geom.offsetY) / geom.scale);
  return [
    Math.max(0, Math.min(geom.vidW - 1, origX)),
    Math.max(0, Math.min(geom.vidH - 1, origY))
  ];
}

export function originalToCanvasCoords(origX, origY, geom) {
  if (!geom) return [0, 0];
  return [
    geom.offsetX + origX * geom.scale,
    geom.offsetY + origY * geom.scale
  ];
}

export function clearOverlayCanvas() {
  if (videoOverlayCanvas) {
    const ctx = videoOverlayCanvas.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, videoOverlayCanvas.width, videoOverlayCanvas.height);
    }
  }
}

export function updateCalibrationUI() {
  const isRedPreview = (currentAnalysisMode === "RED_SIGNAL" && !isResultVideoLoaded);
  const isSpeedPreview = (currentAnalysisMode === "SPEED" && !isResultVideoLoaded);

  if (redSignalCalibrationPanel) {
    redSignalCalibrationPanel.classList.toggle("hidden", !isRedPreview);
  }
  if (redSignalCalibChecklist) {
    redSignalCalibChecklist.classList.toggle("hidden", !isRedPreview);
  }

  if (speedCalibrationPanel) {
    speedCalibrationPanel.classList.toggle("hidden", !isSpeedPreview);
  }
  if (speedCalibChecklist) {
    speedCalibChecklist.classList.toggle("hidden", !isSpeedPreview);
  }

  // 1. RED_SIGNAL UI
  if (isRedPreview) {
    const hasLine = !!(activeCalibration.stop_line && activeCalibration.stop_line.length >= 2);
    const hasRoi = !!(activeCalibration.traffic_light_roi && activeCalibration.traffic_light_roi.length >= 2);

    if (statusStopLineVal) {
      if (hasLine) {
        const p1 = activeCalibration.stop_line[0];
        const p2 = activeCalibration.stop_line[1];
        statusStopLineVal.textContent = `[(${p1[0]}, ${p1[1]}) → (${p2[0]}, ${p2[1]})]`;
        statusStopLineVal.className = "font-bold text-emerald-400 font-mono text-[11px]";
      } else {
        statusStopLineVal.textContent = "Not Configured";
        statusStopLineVal.className = "font-bold text-slate-400 font-mono text-[11px]";
      }
    }

    if (statusRoiVal) {
      if (hasRoi) {
        const r1 = activeCalibration.traffic_light_roi[0];
        const r2 = activeCalibration.traffic_light_roi[1];
        statusRoiVal.textContent = `[(${r1[0]}, ${r1[1]}) → (${r2[0]}, ${r2[1]})]`;
        statusRoiVal.className = "font-bold text-amber-300 font-mono text-[11px]";
      } else {
        statusRoiVal.textContent = "Not Configured";
        statusRoiVal.className = "font-bold text-slate-400 font-mono text-[11px]";
      }
    }

    if (chkStopLine) {
      if (hasLine) {
        chkStopLine.innerHTML = `<i class="fas fa-check-circle text-emerald-400"></i> <span class="text-emerald-300 font-semibold">Stop line configured</span>`;
      } else {
        chkStopLine.innerHTML = `<i class="far fa-circle text-slate-500"></i> <span class="text-slate-400">Stop line not configured</span>`;
      }
    }

    if (chkTrafficRoi) {
      if (hasRoi) {
        chkTrafficRoi.innerHTML = `<i class="fas fa-check-circle text-emerald-400"></i> <span class="text-emerald-300 font-semibold">Traffic light selected</span>`;
      } else {
        chkTrafficRoi.innerHTML = `<i class="far fa-circle text-slate-500"></i> <span class="text-slate-400">Traffic light not selected</span>`;
      }
    }

    if (startBtn) {
      const isReady = (selectedFile && hasLine && hasRoi);
      const label = startBtn.dataset.label || "START RED SIGNAL DETECTION";
      const theme = startBtn.dataset.theme || "bg-red-600 hover:bg-red-500 text-white shadow-red-600/30";

      if (isReady) {
        startBtn.disabled = false;
        startBtn.textContent = label;
        startBtn.className = `px-10 py-4 rounded-2xl ${theme} font-title text-xs sm:text-sm font-black uppercase tracking-wider transition-all duration-300 cursor-pointer shadow-lg`;
      } else {
        startBtn.disabled = true;
        if (!selectedFile) {
          startBtn.textContent = "SELECT A VIDEO TO PROCEED";
        } else if (!hasLine && !hasRoi) {
          startBtn.textContent = "CALIBRATE STOP LINE & TRAFFIC LIGHT";
        } else if (!hasLine) {
          startBtn.textContent = "DRAW STOP LINE TO PROCEED";
        } else if (!hasRoi) {
          startBtn.textContent = "SELECT TRAFFIC LIGHT TO PROCEED";
        }
        startBtn.className = "px-10 py-4 rounded-2xl bg-slate-800 text-slate-500 font-title text-xs sm:text-sm font-black uppercase tracking-wider transition-all duration-300 cursor-not-allowed";
      }
    }
    return;
  }

  // 2. SPEED UI
  if (isSpeedPreview) {
    const hasLineA = !!(activeSpeedCalibration.line_a && activeSpeedCalibration.line_a.length >= 2);
    const hasLineB = !!(activeSpeedCalibration.line_b && activeSpeedCalibration.line_b.length >= 2);

    const distVal = speedDistanceInput ? (parseFloat(speedDistanceInput.value) || 0) : activeSpeedCalibration.distance_meters;
    const limitVal = speedLimitInput ? (parseFloat(speedLimitInput.value) || 0) : activeSpeedCalibration.speed_limit_kmh;
    activeSpeedCalibration.distance_meters = distVal;
    activeSpeedCalibration.speed_limit_kmh = limitVal;
    const hasDist = distVal > 0;
    const hasLimit = limitVal > 0;

    if (statusLineAVal) {
      if (hasLineA) {
        const p1 = activeSpeedCalibration.line_a[0];
        const p2 = activeSpeedCalibration.line_a[1];
        statusLineAVal.textContent = `[(${p1[0]}, ${p1[1]}) → (${p2[0]}, ${p2[1]})]`;
        statusLineAVal.className = "font-bold text-cyan-400 font-mono text-[11px]";
      } else {
        statusLineAVal.textContent = "Not Configured";
        statusLineAVal.className = "font-bold text-slate-400 font-mono text-[11px]";
      }
    }

    if (statusLineBVal) {
      if (hasLineB) {
        const p1 = activeSpeedCalibration.line_b[0];
        const p2 = activeSpeedCalibration.line_b[1];
        statusLineBVal.textContent = `[(${p1[0]}, ${p1[1]}) → (${p2[0]}, ${p2[1]})]`;
        statusLineBVal.className = "font-bold text-amber-400 font-mono text-[11px]";
      } else {
        statusLineBVal.textContent = "Not Configured";
        statusLineBVal.className = "font-bold text-slate-400 font-mono text-[11px]";
      }
    }

    if (chkLineA) {
      if (hasLineA) {
        chkLineA.innerHTML = `<i class="fas fa-check-circle text-cyan-400"></i> <span class="text-cyan-300 font-semibold">Line A configured</span>`;
      } else {
        chkLineA.innerHTML = `<i class="far fa-circle text-slate-500"></i> <span class="text-slate-400">Line A not configured</span>`;
      }
    }

    if (chkLineB) {
      if (hasLineB) {
        chkLineB.innerHTML = `<i class="fas fa-check-circle text-amber-400"></i> <span class="text-amber-300 font-semibold">Line B configured</span>`;
      } else {
        chkLineB.innerHTML = `<i class="far fa-circle text-slate-500"></i> <span class="text-slate-400">Line B not configured</span>`;
      }
    }

    if (chkDistance) {
      if (hasDist) {
        chkDistance.innerHTML = `<i class="fas fa-check-circle text-emerald-400"></i> <span class="text-emerald-300 font-semibold">Distance: ${distVal.toFixed(1)}m</span>`;
      } else {
        chkDistance.innerHTML = `<i class="far fa-circle text-slate-500"></i> <span class="text-slate-400">Distance &gt; 0</span>`;
      }
    }

    if (chkSpeedLimit) {
      if (hasLimit) {
        chkSpeedLimit.innerHTML = `<i class="fas fa-check-circle text-emerald-400"></i> <span class="text-emerald-300 font-semibold">Limit: ${limitVal.toFixed(0)} km/h</span>`;
      } else {
        chkSpeedLimit.innerHTML = `<i class="far fa-circle text-slate-500"></i> <span class="text-slate-400">Speed limit &gt; 0</span>`;
      }
    }

    if (startBtn) {
      const isReady = (selectedFile && hasLineA && hasLineB && hasDist && hasLimit);
      const label = startBtn.dataset.label || "START SPEED DETECTION";
      const theme = startBtn.dataset.theme || "bg-amber-600 hover:bg-amber-500 text-white shadow-amber-600/30";

      if (isReady) {
        startBtn.disabled = false;
        startBtn.textContent = label;
        startBtn.className = `px-10 py-4 rounded-2xl ${theme} font-title text-xs sm:text-sm font-black uppercase tracking-wider transition-all duration-300 cursor-pointer shadow-lg`;
      } else {
        startBtn.disabled = true;
        if (!selectedFile) {
          startBtn.textContent = "SELECT A VIDEO TO PROCEED";
        } else if (!hasLineA && !hasLineB) {
          startBtn.textContent = "CALIBRATE LINE A & LINE B";
        } else if (!hasLineA) {
          startBtn.textContent = "DRAW LINE A TO PROCEED";
        } else if (!hasLineB) {
          startBtn.textContent = "DRAW LINE B TO PROCEED";
        } else if (!hasDist) {
          startBtn.textContent = "ENTER VALID DISTANCE (> 0m)";
        } else if (!hasLimit) {
          startBtn.textContent = "ENTER VALID SPEED LIMIT (> 0 km/h)";
        }
        startBtn.className = "px-10 py-4 rounded-2xl bg-slate-800 text-slate-500 font-title text-xs sm:text-sm font-black uppercase tracking-wider transition-all duration-300 cursor-not-allowed";
      }
    }
    return;
  }

  // 3. Other modules (NO_HELMET) or post-processing view
  if (selectedFile && startBtn && !isResultVideoLoaded) {
    startBtn.disabled = false;
    const label = startBtn.dataset.label || "START DETECTION";
    const theme = startBtn.dataset.theme || "bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg";
    startBtn.textContent = label;
    startBtn.className = `px-10 py-4 rounded-2xl ${theme} font-title text-xs sm:text-sm font-black uppercase tracking-wider transition-all duration-300 cursor-pointer shadow-lg`;
  }
}

export async function drawRedSignalOverlay() {
  if (currentAnalysisMode !== "RED_SIGNAL" || isResultVideoLoaded) {
    clearOverlayCanvas();
    return;
  }

  if (!moduleVideoPlayer || !moduleVideoPlayer.src || moduleVideoPlayer.readyState < 1) {
    return;
  }

  const geom = getRenderedVideoGeometry(moduleVideoPlayer, videoOverlayCanvas);
  if (!geom) return;

  const ctx = videoOverlayCanvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, geom.canvasW, geom.canvasH);

  // 1. Draw Saved or Active STOP LINE
  const rawLine = activeCalibration.stop_line;
  if (rawLine && rawLine.length >= 2) {
    const p1 = parsePoint(rawLine[0]);
    const p2 = parsePoint(rawLine[1]);

    const [x1, y1] = originalToCanvasCoords(p1[0], p1[1], geom);
    const [x2, y2] = originalToCanvasCoords(p2[0], p2[1], geom);

    ctx.save();
    // Glowing red outline
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineWidth = Math.max(4, 5 * geom.scale);
    ctx.strokeStyle = "rgba(239, 68, 68, 0.95)";
    ctx.shadowColor = "rgba(239, 68, 68, 0.9)";
    ctx.shadowBlur = 10;
    ctx.stroke();

    // Solid core line
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#ffffff";
    ctx.shadowBlur = 0;
    ctx.stroke();

    // Circle points for A and B
    [ [x1, y1, "A"], [x2, y2, "B"] ].forEach(([px, py, label]) => {
      ctx.beginPath();
      ctx.arc(px, py, 6, 0, Math.PI * 2);
      ctx.fillStyle = "#ef4444";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();

      ctx.font = "bold 9px sans-serif";
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, px, py);
    });

    // STOP LINE Pill / Badge
    const pillText = "STOP LINE";
    ctx.font = "bold 11px Inter, system-ui, sans-serif";
    const textW = ctx.measureText(pillText).width;
    const pillW = textW + 24;
    const pillH = 22;
    const pillX = Math.min(x1, x2) + 8;
    const pillY = Math.min(y1, y2) + 8;

    ctx.fillStyle = "rgba(15, 23, 42, 0.92)";
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(pillX, pillY, pillW, pillH, 6);
    } else {
      ctx.rect(pillX, pillY, pillW, pillH);
    }
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#ef4444";
    ctx.beginPath();
    ctx.arc(pillX + 9, pillY + pillH / 2, 3.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(pillText, pillX + 17, pillY + pillH / 2 + 0.5);
    ctx.restore();
  }

  // 2. Draw Saved or Active TRAFFIC LIGHT ROI
  let rawRoi = activeCalibration.traffic_light_roi;
  if (Array.isArray(rawRoi) && rawRoi.length > 0 && Array.isArray(rawRoi[0]) && Array.isArray(rawRoi[0][0])) {
    rawRoi = rawRoi[0];
  }

  if (rawRoi && rawRoi.length >= 2) {
    const r1 = parsePoint(rawRoi[0]);
    const r2 = parsePoint(rawRoi[1]);

    const [rx1, ry1] = originalToCanvasCoords(r1[0], r1[1], geom);
    const [rx2, ry2] = originalToCanvasCoords(r2[0], r2[1], geom);
    const rw = rx2 - rx1;
    const rh = ry2 - ry1;

    ctx.save();
    ctx.fillStyle = "rgba(245, 158, 11, 0.22)";
    ctx.fillRect(rx1, ry1, rw, rh);

    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#f59e0b";
    ctx.shadowColor = "rgba(245, 158, 11, 0.9)";
    ctx.shadowBlur = 8;
    ctx.strokeRect(rx1, ry1, rw, rh);

    ctx.shadowBlur = 0;
    const roiLabel = "TRAFFIC LIGHT ROI";
    ctx.font = "bold 10px Inter, system-ui, sans-serif";
    const roiTextW = ctx.measureText(roiLabel).width;
    const roiPillW = roiTextW + 16;
    const roiPillH = 19;
    const roiPillX = rx1;
    const roiPillY = Math.max(4, ry1 - roiPillH - 3);

    ctx.fillStyle = "rgba(15, 23, 42, 0.92)";
    ctx.strokeStyle = "#f59e0b";
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(roiPillX, roiPillY, roiPillW, roiPillH, 4);
    } else {
      ctx.rect(roiPillX, roiPillY, roiPillW, roiPillH);
    }
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#fef08a";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(roiLabel, roiPillX + 8, roiPillY + roiPillH / 2);
    ctx.restore();
  }

  // 3. Dynamic Interactive Drawing Overlays
  if (calibrationTool === "DRAW_LINE_P2" && linePointA && currentMousePosCanvas) {
    const [ax, ay] = originalToCanvasCoords(linePointA[0], linePointA[1], geom);
    const bx = currentMousePosCanvas.x;
    const by = currentMousePosCanvas.y;

    ctx.save();
    // Dashed rubber-band line
    ctx.beginPath();
    ctx.setLineDash([6, 4]);
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#ef4444";
    ctx.stroke();

    // Point A
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(ax, ay, 7, 0, Math.PI * 2);
    ctx.fillStyle = "#ef4444";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();

    ctx.font = "bold 10px sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("A", ax, ay);

    // Current cursor as Point B candidate
    ctx.beginPath();
    ctx.arc(bx, by, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#facc15";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#000000";
    ctx.fillText("B", bx, by);
    ctx.restore();

  } else if (calibrationTool === "DRAW_ROI_DRAGGING" && roiDragStart && currentMousePosCanvas) {
    const [sx, sy] = originalToCanvasCoords(roiDragStart[0], roiDragStart[1], geom);
    const ex = currentMousePosCanvas.x;
    const ey = currentMousePosCanvas.y;
    const rx = Math.min(sx, ex);
    const ry = Math.min(sy, ey);
    const rw = Math.abs(ex - sx);
    const rh = Math.abs(ey - sy);

    ctx.save();
    ctx.fillStyle = "rgba(245, 158, 11, 0.25)";
    ctx.fillRect(rx, ry, rw, rh);

    ctx.setLineDash([5, 3]);
    ctx.strokeStyle = "#f59e0b";
    ctx.lineWidth = 2;
    ctx.strokeRect(rx, ry, rw, rh);
    ctx.restore();
  }
}

// Calibration Buttons Handlers (RED_SIGNAL)
if (btnDrawStopLine) {
  btnDrawStopLine.onclick = (e) => {
    e.stopPropagation();
    if (!moduleVideoPlayer || !moduleVideoPlayer.src) {
      alert("Please choose or load a video first.");
      return;
    }
    moduleVideoPlayer.pause();
    calibrationTool = "DRAW_LINE_P1";
    linePointA = null;
    currentMousePosCanvas = null;
    if (videoOverlayCanvas) {
      videoOverlayCanvas.style.pointerEvents = "auto";
      videoOverlayCanvas.style.cursor = "crosshair";
    }
    if (calibGuideText) {
      calibGuideText.innerHTML = `<span class="text-yellow-300 font-bold"><i class="fas fa-crosshairs"></i> Step 1: Click Point A</span> on the roadway at the physical stopping boundary across traffic.`;
    }
    drawRedSignalOverlay();
  };
}

if (btnDrawTrafficRoi) {
  btnDrawTrafficRoi.onclick = (e) => {
    e.stopPropagation();
    if (!moduleVideoPlayer || !moduleVideoPlayer.src) {
      alert("Please choose or load a video first.");
      return;
    }
    moduleVideoPlayer.pause();
    calibrationTool = "DRAW_ROI_READY";
    roiDragStart = null;
    roiDragCurrent = null;
    currentMousePosCanvas = null;
    if (videoOverlayCanvas) {
      videoOverlayCanvas.style.pointerEvents = "auto";
      videoOverlayCanvas.style.cursor = "crosshair";
    }
    if (calibGuideText) {
      calibGuideText.innerHTML = `<span class="text-amber-300 font-bold"><i class="fas fa-vector-square"></i> Drag Box:</span> Click and drag a rectangle over the relevant traffic light signal.`;
    }
    drawRedSignalOverlay();
  };
}

if (btnResetCalibration) {
  btnResetCalibration.onclick = (e) => {
    e.stopPropagation();
    calibrationTool = null;
    linePointA = null;
    roiDragStart = null;
    roiDragCurrent = null;
    currentMousePosCanvas = null;
    activeCalibration.stop_line = null;
    activeCalibration.traffic_light_roi = null;
    if (videoOverlayCanvas) {
      videoOverlayCanvas.style.pointerEvents = "none";
      videoOverlayCanvas.style.cursor = "default";
    }
    if (calibGuideText) {
      calibGuideText.textContent = "Calibration reset. Click 'Draw Stop Line' to set the stop line, or 'Select Traffic Light' to set the traffic signal.";
    }
    updateCalibrationUI();
    drawRedSignalOverlay();
  };
}

// Calibration Buttons Handlers (SPEED)
if (btnDrawSpeedLineA) {
  btnDrawSpeedLineA.onclick = (e) => {
    e.stopPropagation();
    if (!moduleVideoPlayer || !moduleVideoPlayer.src) {
      alert("Please choose or load a video first.");
      return;
    }
    moduleVideoPlayer.pause();
    calibrationTool = "DRAW_SPEED_LINE_A_P1";
    speedLinePoint1 = null;
    currentMousePosCanvas = null;
    if (videoOverlayCanvas) {
      videoOverlayCanvas.style.pointerEvents = "auto";
      videoOverlayCanvas.style.cursor = "crosshair";
    }
    if (speedCalibGuideText) {
      speedCalibGuideText.innerHTML = `<span class="text-cyan-300 font-bold"><i class="fas fa-crosshairs"></i> Line A (Point 1):</span> Click Point A1 on the roadway for the entry line.`;
    }
    drawSpeedOverlay();
  };
}

if (btnDrawSpeedLineB) {
  btnDrawSpeedLineB.onclick = (e) => {
    e.stopPropagation();
    if (!moduleVideoPlayer || !moduleVideoPlayer.src) {
      alert("Please choose or load a video first.");
      return;
    }
    moduleVideoPlayer.pause();
    calibrationTool = "DRAW_SPEED_LINE_B_P1";
    speedLinePoint1 = null;
    currentMousePosCanvas = null;
    if (videoOverlayCanvas) {
      videoOverlayCanvas.style.pointerEvents = "auto";
      videoOverlayCanvas.style.cursor = "crosshair";
    }
    if (speedCalibGuideText) {
      speedCalibGuideText.innerHTML = `<span class="text-amber-300 font-bold"><i class="fas fa-crosshairs"></i> Line B (Point 1):</span> Click Point B1 on the roadway for the exit line.`;
    }
    drawSpeedOverlay();
  };
}

if (btnResetSpeedCalibration) {
  btnResetSpeedCalibration.onclick = (e) => {
    e.stopPropagation();
    calibrationTool = null;
    speedLinePoint1 = null;
    currentMousePosCanvas = null;
    activeSpeedCalibration.line_a = null;
    activeSpeedCalibration.line_b = null;
    if (speedDistanceInput) speedDistanceInput.value = "10.0";
    if (speedLimitInput) speedLimitInput.value = "60";
    activeSpeedCalibration.distance_meters = 10.0;
    activeSpeedCalibration.speed_limit_kmh = 60.0;
    if (videoOverlayCanvas) {
      videoOverlayCanvas.style.pointerEvents = "none";
      videoOverlayCanvas.style.cursor = "default";
    }
    if (speedCalibGuideText) {
      speedCalibGuideText.textContent = "Speed calibration reset. Click 'Draw Line A' and 'Draw Line B' to calibrate.";
    }
    updateCalibrationUI();
    drawSpeedOverlay();
  };
}

// Distance and Speed Limit input listeners
if (speedDistanceInput) {
  speedDistanceInput.addEventListener("input", () => {
    const d = parseFloat(speedDistanceInput.value) || 0;
    activeSpeedCalibration.distance_meters = d;
    updateCalibrationUI();
    drawSpeedOverlay();
  });
}

if (speedLimitInput) {
  speedLimitInput.addEventListener("input", () => {
    const l = parseFloat(speedLimitInput.value) || 0;
    activeSpeedCalibration.speed_limit_kmh = l;
    updateCalibrationUI();
    drawSpeedOverlay();
  });
}

// Canvas Mouse Interactions
if (videoOverlayCanvas) {
  videoOverlayCanvas.addEventListener("mousemove", (e) => {
    if (!calibrationTool) return;
    const rect = videoOverlayCanvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    currentMousePosCanvas = { x: cx, y: cy };

    if (calibrationTool === "DRAW_ROI_DRAGGING") {
      const geom = getRenderedVideoGeometry(moduleVideoPlayer, videoOverlayCanvas);
      if (geom) {
        roiDragCurrent = canvasToOriginalCoords(cx, cy, geom);
      }
      drawRedSignalOverlay();
    } else if (calibrationTool === "DRAW_LINE_P2") {
      drawRedSignalOverlay();
    } else if (calibrationTool === "DRAW_SPEED_LINE_A_P2" || calibrationTool === "DRAW_SPEED_LINE_B_P2") {
      drawSpeedOverlay();
    }
  });

  videoOverlayCanvas.addEventListener("mousedown", (e) => {
    if (calibrationTool !== "DRAW_ROI_READY") return;
    const rect = videoOverlayCanvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const geom = getRenderedVideoGeometry(moduleVideoPlayer, videoOverlayCanvas);
    if (!geom) return;

    roiDragStart = canvasToOriginalCoords(cx, cy, geom);
    roiDragCurrent = roiDragStart;
    calibrationTool = "DRAW_ROI_DRAGGING";
    drawRedSignalOverlay();
  });

  videoOverlayCanvas.addEventListener("mouseup", (e) => {
    if (calibrationTool !== "DRAW_ROI_DRAGGING") return;
    const rect = videoOverlayCanvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const geom = getRenderedVideoGeometry(moduleVideoPlayer, videoOverlayCanvas);
    if (!geom || !roiDragStart) return;

    const roiEnd = canvasToOriginalCoords(cx, cy, geom);
    const rx1 = Math.min(roiDragStart[0], roiEnd[0]);
    const ry1 = Math.min(roiDragStart[1], roiEnd[1]);
    const rx2 = Math.max(roiDragStart[0], roiEnd[0]);
    const ry2 = Math.max(roiDragStart[1], roiEnd[1]);

    if ((rx2 - rx1) >= 8 && (ry2 - ry1) >= 8) {
      activeCalibration.traffic_light_roi = [[rx1, ry1], [rx2, ry2]];
      if (calibGuideText) {
        calibGuideText.innerHTML = `✓ Traffic Light ROI set: <strong class="text-amber-300">[(${rx1}, ${ry1}) → (${rx2}, ${ry2})]</strong>.`;
      }
    } else {
      if (calibGuideText) {
        calibGuideText.textContent = "Selected box was too small. Please drag a larger rectangle around the traffic light.";
      }
    }

    calibrationTool = null;
    roiDragStart = null;
    roiDragCurrent = null;
    currentMousePosCanvas = null;
    videoOverlayCanvas.style.pointerEvents = "none";
    videoOverlayCanvas.style.cursor = "default";
    updateCalibrationUI();
    drawRedSignalOverlay();
  });

  videoOverlayCanvas.addEventListener("click", (e) => {
    const rect = videoOverlayCanvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const geom = getRenderedVideoGeometry(moduleVideoPlayer, videoOverlayCanvas);
    if (!geom) return;

    if (calibrationTool === "DRAW_LINE_P1") {
      linePointA = canvasToOriginalCoords(cx, cy, geom);
      calibrationTool = "DRAW_LINE_P2";

      if (calibGuideText) {
        calibGuideText.innerHTML = `<span class="text-emerald-400 font-bold"><i class="fas fa-check"></i> Point A set at (${linePointA[0]}, ${linePointA[1]})</span>. Now click <strong class="text-yellow-300">Point B</strong> across the road.`;
      }
      drawRedSignalOverlay();

    } else if (calibrationTool === "DRAW_LINE_P2") {
      if (!linePointA) return;
      const linePointB = canvasToOriginalCoords(cx, cy, geom);
      activeCalibration.stop_line = [linePointA, linePointB];

      calibrationTool = null;
      linePointA = null;
      currentMousePosCanvas = null;
      videoOverlayCanvas.style.pointerEvents = "none";
      videoOverlayCanvas.style.cursor = "default";

      if (calibGuideText) {
        calibGuideText.innerHTML = `✓ Stop Line calibrated: <strong class="text-red-400">[(${activeCalibration.stop_line[0][0]}, ${activeCalibration.stop_line[0][1]}) → (${activeCalibration.stop_line[1][0]}, ${activeCalibration.stop_line[1][1]})]</strong>.`;
      }
      updateCalibrationUI();
      drawRedSignalOverlay();

    } else if (calibrationTool === "DRAW_SPEED_LINE_A_P1") {
      speedLinePoint1 = canvasToOriginalCoords(cx, cy, geom);
      calibrationTool = "DRAW_SPEED_LINE_A_P2";

      if (speedCalibGuideText) {
        speedCalibGuideText.innerHTML = `<span class="text-cyan-300 font-bold"><i class="fas fa-check"></i> Point A1 set at (${speedLinePoint1[0]}, ${speedLinePoint1[1]})</span>. Now click <strong class="text-yellow-300">Point A2</strong> across the road.`;
      }
      drawSpeedOverlay();

    } else if (calibrationTool === "DRAW_SPEED_LINE_A_P2") {
      if (!speedLinePoint1) return;
      const pt2 = canvasToOriginalCoords(cx, cy, geom);
      activeSpeedCalibration.line_a = [speedLinePoint1, pt2];

      calibrationTool = null;
      speedLinePoint1 = null;
      currentMousePosCanvas = null;
      videoOverlayCanvas.style.pointerEvents = "none";
      videoOverlayCanvas.style.cursor = "default";

      if (speedCalibGuideText) {
        speedCalibGuideText.innerHTML = `✓ Line A calibrated: <strong class="text-cyan-400">[(${activeSpeedCalibration.line_a[0][0]}, ${activeSpeedCalibration.line_a[0][1]}) → (${activeSpeedCalibration.line_a[1][0]}, ${activeSpeedCalibration.line_a[1][1]})]</strong>.`;
      }
      updateCalibrationUI();
      drawSpeedOverlay();

    } else if (calibrationTool === "DRAW_SPEED_LINE_B_P1") {
      speedLinePoint1 = canvasToOriginalCoords(cx, cy, geom);
      calibrationTool = "DRAW_SPEED_LINE_B_P2";

      if (speedCalibGuideText) {
        speedCalibGuideText.innerHTML = `<span class="text-amber-300 font-bold"><i class="fas fa-check"></i> Point B1 set at (${speedLinePoint1[0]}, ${speedLinePoint1[1]})</span>. Now click <strong class="text-yellow-300">Point B2</strong> across the road.`;
      }
      drawSpeedOverlay();

    } else if (calibrationTool === "DRAW_SPEED_LINE_B_P2") {
      if (!speedLinePoint1) return;
      const pt2 = canvasToOriginalCoords(cx, cy, geom);
      activeSpeedCalibration.line_b = [speedLinePoint1, pt2];

      calibrationTool = null;
      speedLinePoint1 = null;
      currentMousePosCanvas = null;
      videoOverlayCanvas.style.pointerEvents = "none";
      videoOverlayCanvas.style.cursor = "default";

      if (speedCalibGuideText) {
        speedCalibGuideText.innerHTML = `✓ Line B calibrated: <strong class="text-amber-400">[(${activeSpeedCalibration.line_b[0][0]}, ${activeSpeedCalibration.line_b[0][1]}) → (${activeSpeedCalibration.line_b[1][0]}, ${activeSpeedCalibration.line_b[1][1]})]</strong>.`;
      }
      updateCalibrationUI();
      drawSpeedOverlay();
    }
  });
}

export async function drawSpeedOverlay() {
  if (currentAnalysisMode !== "SPEED" || isResultVideoLoaded) {
    clearOverlayCanvas();
    return;
  }

  if (!moduleVideoPlayer || !moduleVideoPlayer.src || moduleVideoPlayer.readyState < 1) {
    return;
  }

  const geom = getRenderedVideoGeometry(moduleVideoPlayer, videoOverlayCanvas);
  if (!geom) return;

  const ctx = videoOverlayCanvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, geom.canvasW, geom.canvasH);

  // 1. Draw Saved or Active Line A (Cyan)
  const rawLineA = activeSpeedCalibration.line_a;
  if (rawLineA && rawLineA.length >= 2) {
    const p1 = parsePoint(rawLineA[0]);
    const p2 = parsePoint(rawLineA[1]);

    const [x1, y1] = originalToCanvasCoords(p1[0], p1[1], geom);
    const [x2, y2] = originalToCanvasCoords(p2[0], p2[1], geom);

    ctx.save();
    // Glowing cyan outline
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineWidth = Math.max(4, 5 * geom.scale);
    ctx.strokeStyle = "rgba(6, 182, 212, 0.95)";
    ctx.shadowColor = "rgba(6, 182, 212, 0.9)";
    ctx.shadowBlur = 10;
    ctx.stroke();

    // Solid core line
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#ffffff";
    ctx.shadowBlur = 0;
    ctx.stroke();

    // Circle points
    [[x1, y1, "A1"], [x2, y2, "A2"]].forEach(([px, py, label]) => {
      ctx.beginPath();
      ctx.arc(px, py, 6, 0, Math.PI * 2);
      ctx.fillStyle = "#06b6d4";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();

      ctx.font = "bold 8px sans-serif";
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, px, py);
    });

    // Pill badge for Line A
    const pillText = "SPEED LINE A (ENTRY)";
    ctx.font = "bold 11px Inter, system-ui, sans-serif";
    const textW = ctx.measureText(pillText).width;
    const pillW = textW + 24;
    const pillH = 22;
    const pillX = Math.min(x1, x2) + 8;
    const pillY = Math.min(y1, y2) + 8;

    ctx.fillStyle = "rgba(15, 23, 42, 0.92)";
    ctx.strokeStyle = "#06b6d4";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(pillX, pillY, pillW, pillH, 6);
    } else {
      ctx.rect(pillX, pillY, pillW, pillH);
    }
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#06b6d4";
    ctx.beginPath();
    ctx.arc(pillX + 9, pillY + pillH / 2, 3.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(pillText, pillX + 17, pillY + pillH / 2 + 0.5);
    ctx.restore();
  }

  // 2. Draw Saved or Active Line B (Orange)
  const rawLineB = activeSpeedCalibration.line_b;
  if (rawLineB && rawLineB.length >= 2) {
    const p1 = parsePoint(rawLineB[0]);
    const p2 = parsePoint(rawLineB[1]);

    const [x1, y1] = originalToCanvasCoords(p1[0], p1[1], geom);
    const [x2, y2] = originalToCanvasCoords(p2[0], p2[1], geom);

    ctx.save();
    // Glowing orange outline
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineWidth = Math.max(4, 5 * geom.scale);
    ctx.strokeStyle = "rgba(245, 158, 11, 0.95)";
    ctx.shadowColor = "rgba(245, 158, 11, 0.9)";
    ctx.shadowBlur = 10;
    ctx.stroke();

    // Solid core line
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#ffffff";
    ctx.shadowBlur = 0;
    ctx.stroke();

    // Circle points
    [[x1, y1, "B1"], [x2, y2, "B2"]].forEach(([px, py, label]) => {
      ctx.beginPath();
      ctx.arc(px, py, 6, 0, Math.PI * 2);
      ctx.fillStyle = "#f59e0b";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();

      ctx.font = "bold 8px sans-serif";
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, px, py);
    });

    // Pill badge for Line B
    const limitKmh = activeSpeedCalibration.speed_limit_kmh || 60;
    const pillText = `SPEED LINE B (EXIT) [${limitKmh.toFixed(0)} km/h]`;
    ctx.font = "bold 11px Inter, system-ui, sans-serif";
    const textW = ctx.measureText(pillText).width;
    const pillW = textW + 24;
    const pillH = 22;
    const pillX = Math.min(x1, x2) + 8;
    const pillY = Math.min(y1, y2) + 8;

    ctx.fillStyle = "rgba(15, 23, 42, 0.92)";
    ctx.strokeStyle = "#f59e0b";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(pillX, pillY, pillW, pillH, 6);
    } else {
      ctx.rect(pillX, pillY, pillW, pillH);
    }
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#f59e0b";
    ctx.beginPath();
    ctx.arc(pillX + 9, pillY + pillH / 2, 3.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(pillText, pillX + 17, pillY + pillH / 2 + 0.5);
    ctx.restore();
  }

  // 3. Dynamic Interactive Drawing Overlays for Line A or Line B
  if (calibrationTool === "DRAW_SPEED_LINE_A_P2" && speedLinePoint1 && currentMousePosCanvas) {
    const [ax, ay] = originalToCanvasCoords(speedLinePoint1[0], speedLinePoint1[1], geom);
    const bx = currentMousePosCanvas.x;
    const by = currentMousePosCanvas.y;

    ctx.save();
    // Dashed rubber-band line
    ctx.beginPath();
    ctx.setLineDash([6, 4]);
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#06b6d4";
    ctx.stroke();

    // Point A1
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(ax, ay, 7, 0, Math.PI * 2);
    ctx.fillStyle = "#06b6d4";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();

    ctx.font = "bold 9px sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("A1", ax, ay);

    // Current cursor as Point A2 candidate
    ctx.beginPath();
    ctx.arc(bx, by, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#a5f3fc";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#000000";
    ctx.fillText("A2", bx, by);
    ctx.restore();

  } else if (calibrationTool === "DRAW_SPEED_LINE_B_P2" && speedLinePoint1 && currentMousePosCanvas) {
    const [ax, ay] = originalToCanvasCoords(speedLinePoint1[0], speedLinePoint1[1], geom);
    const bx = currentMousePosCanvas.x;
    const by = currentMousePosCanvas.y;

    ctx.save();
    // Dashed rubber-band line
    ctx.beginPath();
    ctx.setLineDash([6, 4]);
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#f59e0b";
    ctx.stroke();

    // Point B1
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(ax, ay, 7, 0, Math.PI * 2);
    ctx.fillStyle = "#f59e0b";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();

    ctx.font = "bold 9px sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("B1", ax, ay);

    // Current cursor as Point B2 candidate
    ctx.beginPath();
    ctx.arc(bx, by, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#fef08a";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#000000";
    ctx.fillText("B2", bx, by);
    ctx.restore();
  }
}

export function drawActiveOverlay() {
  if (currentAnalysisMode === "RED_SIGNAL") {
    drawRedSignalOverlay();
  } else if (currentAnalysisMode === "SPEED") {
    drawSpeedOverlay();
  } else {
    clearOverlayCanvas();
  }
}

// Attach overlay event listeners
if (moduleVideoPlayer) {
  moduleVideoPlayer.addEventListener("loadedmetadata", () => {
    if (!isResultVideoLoaded) {
      drawActiveOverlay();
    }
  });

  moduleVideoPlayer.addEventListener("loadeddata", () => {
    if (!isResultVideoLoaded) {
      drawActiveOverlay();
    }
  });
}

window.addEventListener("resize", () => {
  if (!isResultVideoLoaded) {
    drawActiveOverlay();
  }
});

document.addEventListener("fullscreenchange", () => {
  if (!isResultVideoLoaded) {
    drawActiveOverlay();
  }
});

// =====================================================================
// Dedicated Module Workspace Opening Flow
// =====================================================================

export async function openModule(moduleType) {
  const normType = (moduleType || "RED_SIGNAL").toUpperCase().trim();
  currentAnalysisMode = normType;

  // Switch to Module Workspace
  showView("module");

  // Ensure config loaded for dynamic values
  if (!roadConfigCache) {
    try {
      roadConfigCache = await getConfig();
    } catch (e) {
      console.warn("Could not load config:", e);
      roadConfigCache = {
        speed: { speed_limit_kmh: 60.0, distance_meters: 10.0 }
      };
    }
  }

  const speedLimit = roadConfigCache?.speed?.speed_limit_kmh || 60.0;
  const speedDist = roadConfigCache?.speed?.distance_meters || 10.0;

  // Update Header Banner
  const bannerCard = document.getElementById("module-banner-card");
  const iconEl = document.getElementById("module-icon");
  const titleEl = document.getElementById("module-title");
  const descEl = document.getElementById("module-description");
  const ruleContent = document.getElementById("module-rule-content");

  if (normType === "RED_SIGNAL") {
    bannerCard.className = "glass p-6 sm:p-8 rounded-3xl border border-red-500/40 glow-red transition-all duration-300";
    iconEl.textContent = "🚦";
    titleEl.textContent = "RED SIGNAL VIOLATION DETECTION";
    titleEl.className = "font-title text-xl sm:text-2xl font-black text-red-400";
    descEl.textContent = "Detect vehicles crossing the configured stop line while the traffic signal is red.";

    ruleContent.innerHTML = `
      <div class="font-bold text-red-300 flex items-center gap-2 mb-2">
        <i class="fas fa-traffic-light"></i> Traffic Light Signal Rules:
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 font-mono text-[11px] mb-2">
        <div class="p-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300">
          <b>🔴 RED:</b> Stop before the stop line
        </div>
        <div class="p-2 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-yellow-300">
          <b>🟡 YELLOW:</b> Prepare to stop when safe
        </div>
        <div class="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
          <b>🟢 GREEN:</b> Proceed when safe
        </div>
      </div>
      <div class="text-slate-300 text-xs">
        A violation is generated when a tracked vehicle crosses the configured stop line while the detected traffic signal is <b>RED</b>.
      </div>
    `;

    if (sampleBtnText) sampleBtnText.textContent = "Load Sample Red Light Video";
    updateStartButtonTheme("START RED SIGNAL DETECTION", "bg-red-600 hover:bg-red-500 text-white shadow-red-600/30");

  } else if (normType === "SPEED") {
    bannerCard.className = "glass p-6 sm:p-8 rounded-3xl border border-amber-500/40 glow-amber transition-all duration-300";
    iconEl.textContent = "🏎️";
    titleEl.textContent = "SPEED VIOLATION DETECTION";
    titleEl.className = "font-title text-xl sm:text-2xl font-black text-amber-400";
    descEl.textContent = "Estimate vehicle speed using calibrated road measurement lines and identify vehicles exceeding the speed limit.";

    ruleContent.innerHTML = `
      <div class="font-bold text-amber-300 flex items-center gap-2 mb-2">
        <i class="fas fa-tachometer-alt"></i> Traffic Speed Rule:
      </div>
      <div class="text-slate-300 text-xs mb-2">
        Vehicles must remain within the configured road speed limit.
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono text-[11px] mb-2">
        <div class="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300">
          <b>Configured Speed Limit:</b> ${speedLimit.toFixed(1)} km/h
        </div>
        <div class="p-2.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-300">
          <b>Measurement Distance:</b> ${speedDist.toFixed(1)} meters
        </div>
      </div>
      <div class="text-slate-400 text-[11px] italic">
        Vehicles are tracked between two calibrated measurement lines. Travel time and configured real-world distance are used to estimate speed. (Computer vision research prototype).
      </div>
    `;

    if (sampleBtnText) sampleBtnText.textContent = "Load Sample Speed Video";
    updateStartButtonTheme("START SPEED DETECTION", "bg-amber-600 hover:bg-amber-500 text-white shadow-amber-600/30");

  } else if (normType === "NO_HELMET") {
    bannerCard.className = "glass p-6 sm:p-8 rounded-3xl border border-yellow-400/40 glow-yellow transition-all duration-300";
    iconEl.textContent = "🪖";
    titleEl.textContent = "NO-HELMET VIOLATION DETECTION";
    titleEl.className = "font-title text-xl sm:text-2xl font-black text-yellow-400";
    descEl.textContent = "Detect motorcycle riders travelling without a protective helmet.";

    ruleContent.innerHTML = `
      <div class="font-bold text-yellow-300 flex items-center gap-2 mb-2">
        <i class="fas fa-hard-hat"></i> Traffic Safety Rule:
      </div>
      <div class="text-slate-300 text-xs mb-2">
        Motorcycle riders must wear a protective helmet.
      </div>
      <div class="p-3 rounded-lg bg-yellow-500/10 border border-yellow-400/30 text-yellow-200 font-mono text-[11px]">
        <b>Pipeline:</b> Motorcycle Detection → Rider Association → Helmet Analysis → Temporal Confirmation (≥3 frames) → Violation
      </div>
    `;

    if (sampleBtnText) sampleBtnText.textContent = "Load Sample Helmet Video";
    updateStartButtonTheme("START HELMET DETECTION", "bg-yellow-500 hover:bg-yellow-400 text-black shadow-yellow-500/30");
  }

  // Reset file selection & UI elements for new session
  resetUploadState();
}
window.openModule = openModule;

function updateStartButtonTheme(label, classes) {
  if (!startBtn) return;
  startBtn.dataset.label = label;
  startBtn.dataset.theme = classes;

  if (selectedFile) {
    startBtn.textContent = label;
    startBtn.disabled = false;
    startBtn.className = `px-10 py-4 rounded-2xl ${classes} font-title text-xs sm:text-sm font-black uppercase tracking-wider transition-all duration-300 cursor-pointer shadow-lg`;
  } else {
    startBtn.textContent = label;
    startBtn.disabled = true;
    startBtn.className = "px-10 py-4 rounded-2xl bg-slate-800 text-slate-500 font-title text-xs sm:text-sm font-black uppercase tracking-wider transition-all duration-300 cursor-not-allowed";
  }
}

function resetUploadState() {
  selectedFile = null;
  currentVideoId = null;
  isResultVideoLoaded = false;
  calibrationTool = null;
  linePointA = null;
  roiDragStart = null;
  roiDragCurrent = null;
  currentMousePosCanvas = null;
  activeCalibration.stop_line = null;
  activeCalibration.traffic_light_roi = null;
  activeCalibration.traffic_light_mode = "red";

  activeSpeedCalibration.line_a = null;
  activeSpeedCalibration.line_b = null;
  speedLinePoint1 = null;
  if (speedDistanceInput) speedDistanceInput.value = roadConfigCache?.speed?.distance_meters ?? "10.0";
  if (speedLimitInput) speedLimitInput.value = roadConfigCache?.speed?.speed_limit_kmh ?? "60";
  activeSpeedCalibration.distance_meters = parseFloat(speedDistanceInput?.value) || 10.0;
  activeSpeedCalibration.speed_limit_kmh = parseFloat(speedLimitInput?.value) || 60.0;

  if (videoOverlayCanvas) {
    videoOverlayCanvas.style.pointerEvents = "none";
    videoOverlayCanvas.style.cursor = "default";
  }

  clearOverlayCanvas();
  updateCalibrationUI();

  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }

  if (fileInput) fileInput.value = "";
  if (moduleVideoPlayer) {
    moduleVideoPlayer.pause();
    moduleVideoPlayer.removeAttribute("src");
    moduleVideoPlayer.load();
  }

  if (dropZone) dropZone.classList.remove("hidden");
  if (videoPreviewWrapper) videoPreviewWrapper.classList.add("hidden");
  if (videoWorkspaceBox) {
    videoWorkspaceBox.className = "rounded-2xl border-2 border-dashed border-white/20 hover:border-cyan-400/60 transition bg-black/40 overflow-hidden relative";
  }

  if (uploadStatusEl) uploadStatusEl.textContent = "";
  if (processingBox) processingBox.classList.add("hidden");
  if (detectedViolationsSection) detectedViolationsSection.classList.add("hidden");
  if (violationsCardsContainer) violationsCardsContainer.innerHTML = "";

  if (startBtn) {
    startBtn.disabled = true;
    const label = startBtn.dataset.label || "START DETECTION";
    startBtn.textContent = label;
    startBtn.className = "px-10 py-4 rounded-2xl bg-slate-800 text-slate-500 font-title text-xs sm:text-sm font-black uppercase tracking-wider transition-all duration-300 cursor-not-allowed";
  }
}

// =====================================================================
// File Drag & Drop & Sample Load Handlers
// =====================================================================

if (dropZone && fileInput) {
  dropZone.onclick = (e) => {
    // Prevent triggering if clicked sample button
    if (e.target.closest("#load-sample-btn")) return;
    fileInput.click();
  };

  dropZone.ondragover = (e) => {
    e.preventDefault();
    dropZone.classList.add("border-cyan-400", "bg-cyan-500/5");
  };

  dropZone.ondragleave = () => {
    dropZone.classList.remove("border-cyan-400", "bg-cyan-500/5");
  };

  dropZone.ondrop = (e) => {
    e.preventDefault();
    dropZone.classList.remove("border-cyan-400", "bg-cyan-500/5");
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  };

  fileInput.onchange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileSelected(e.target.files[0]);
    }
  };
}

if (changeVideoBtn) {
  changeVideoBtn.onclick = (e) => {
    e.stopPropagation();
    resetUploadState();
    if (fileInput) fileInput.click();
  };
}

if (loadSampleBtn) {
  loadSampleBtn.onclick = async (e) => {
    e.stopPropagation();
    let sampleName = "sample_red_light_traffic.mp4";
    if (currentAnalysisMode === "SPEED") sampleName = "sample_speed_traffic.mp4";
    else if (currentAnalysisMode === "NO_HELMET") sampleName = "sample_helmet_traffic.mp4";

    uploadStatusEl.textContent = `Loading verified sample ${sampleName}...`;
    uploadStatusEl.className = "text-xs text-cyan-300 font-semibold";

    try {
      const res = await fetch(`./${sampleName}`);
      if (!res.ok) throw new Error(`Could not load ${sampleName}: HTTP ${res.status}`);
      const blob = await res.blob();
      const file = new File([blob], sampleName, { type: "video/mp4" });

      if (currentAnalysisMode === "RED_SIGNAL") {
        // Pre-configure verified roadway stop boundary across vehicle path for sample video:
        // Vehicles in sample_red_light_traffic.mp4 travel horizontally left-to-right (x ~ 450 to 1050, y ~ 700)
        // Calibrated stop boundary across road: Point A=(680, 540) to Point B=(680, 880)
        activeCalibration.stop_line = [[680, 540], [680, 880]];
        activeCalibration.traffic_light_roi = [[50, 50], [150, 200]];
        activeCalibration.traffic_light_mode = "red";
      } else if (currentAnalysisMode === "SPEED") {
        // Pre-configure verified speed measurement lines for sample speed video:
        // Vehicles travel left-to-right across x=520 (Line A) and x=730 (Line B)
        activeSpeedCalibration.line_a = [[520, 450], [520, 950]];
        activeSpeedCalibration.line_b = [[730, 450], [730, 950]];
        activeSpeedCalibration.distance_meters = 10.0;
        activeSpeedCalibration.speed_limit_kmh = 60.0;
        if (speedDistanceInput) speedDistanceInput.value = "10.0";
        if (speedLimitInput) speedLimitInput.value = "60";
      }

      handleFileSelected(file);
    } catch (err) {
      console.error("Failed to load sample video:", err);
      uploadStatusEl.textContent = `Error loading sample video: ${err.message}`;
      uploadStatusEl.className = "text-xs text-red-400 font-semibold";
    }
  };
}

function handleFileSelected(file) {
  if (!file) return;

  const allowedExtensions = [".mp4", ".avi", ".mov", ".mkv"];
  const fileExt = file.name.substring(file.name.lastIndexOf(".")).toLowerCase();

  if (!allowedExtensions.includes(fileExt)) {
    alert(`Unsupported file format '${fileExt}'. Please select an MP4, AVI, MOV, or MKV video.`);
    return;
  }

  if (file.size > 500 * 1024 * 1024) {
    alert("File size exceeds the 500MB limit.");
    return;
  }

  selectedFile = file;
  isResultVideoLoaded = false;
  clearOverlayCanvas();

  // For custom non-sample uploads, prompt user to calibrate
  if (currentAnalysisMode === "RED_SIGNAL") {
    if (!activeCalibration.stop_line || !activeCalibration.traffic_light_roi) {
      activeCalibration.stop_line = null;
      activeCalibration.traffic_light_roi = null;
      activeCalibration.traffic_light_mode = "red";
      if (calibGuideText) {
        calibGuideText.innerHTML = `Video loaded. Click <strong class="text-red-400">Draw Stop Line</strong> to set the stopping boundary across the road, and <strong class="text-amber-300">Select Traffic Light</strong> to box the signal light.`;
      }
    } else {
      if (calibGuideText) {
        calibGuideText.innerHTML = `Detection zone configured. You can proceed with detection or click <strong class="text-red-400">Draw Stop Line</strong> to adjust.`;
      }
    }
  } else if (currentAnalysisMode === "SPEED") {
    if (!activeSpeedCalibration.line_a || !activeSpeedCalibration.line_b) {
      activeSpeedCalibration.line_a = null;
      activeSpeedCalibration.line_b = null;
      if (speedCalibGuideText) {
        speedCalibGuideText.innerHTML = `Video loaded. Click <strong class="text-cyan-400">Draw Line A</strong> and <strong class="text-amber-400">Draw Line B</strong> across the road to calibrate measurement lines.`;
      }
    } else {
      if (speedCalibGuideText) {
        speedCalibGuideText.innerHTML = `Speed lines configured. You can proceed with detection or click <strong class="text-cyan-400">Draw Line A</strong> / <strong class="text-amber-400">Draw Line B</strong> to adjust.`;
      }
    }
  }

  // Update unified video container inside the exact same box
  if (dropZone) dropZone.classList.add("hidden");
  if (videoPreviewWrapper) videoPreviewWrapper.classList.remove("hidden");
  if (videoWorkspaceBox) {
    videoWorkspaceBox.className = "rounded-2xl border border-cyan-500/40 bg-black/60 shadow-2xl overflow-hidden relative";
  }

  if (videoStatusIndicator) {
    videoStatusIndicator.textContent = "SELECTED VIDEO (PREVIEW)";
    videoStatusIndicator.className = "px-2.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 text-[11px] font-bold shrink-0";
  }

  if (selectedFileNameEl) selectedFileNameEl.textContent = file.name;
  if (selectedFileSizeEl) selectedFileSizeEl.textContent = `${(file.size / (1024 * 1024)).toFixed(1)} MB`;
  if (videoMetaTag) videoMetaTag.textContent = "Local Video Preview (Pre-analysis)";

  // Load preview in player
  try {
    const localVideoUrl = URL.createObjectURL(file);
    moduleVideoPlayer.src = localVideoUrl;
    moduleVideoPlayer.load();
    setTimeout(() => {
      drawActiveOverlay();
    }, 50);
  } catch (err) {
    console.warn("Could not set local video preview:", err);
  }

  uploadStatusEl.textContent = `Selected: ${file.name} • Ready for analysis.`;
  uploadStatusEl.className = "text-xs text-cyan-300 font-semibold";

  if (detectedViolationsSection) detectedViolationsSection.classList.add("hidden");
  if (violationsCardsContainer) violationsCardsContainer.innerHTML = "";

  // Synchronize calibration UI & button state
  updateCalibrationUI();
}

// =====================================================================
// Start Detection Workflow
// =====================================================================

if (startBtn) {
  startBtn.onclick = startDetectionProcess;
}

async function startDetectionProcess() {
  if (!selectedFile) {
    alert("Please select a video file first.");
    return;
  }

  const activeMode = currentAnalysisMode;
  startBtn.disabled = true;
  startBtn.className = "px-10 py-4 rounded-2xl bg-slate-800 text-slate-400 font-title text-xs sm:text-sm font-black uppercase tracking-wider transition-all duration-300 cursor-wait";
  startBtn.textContent = "UPLOADING...";

  // Show processing progress UI
  processingBox.classList.remove("hidden");
  progressBarFill.style.width = "0%";
  progressPercentageLabel.textContent = "Progress: 0%";
  processingStatusDetail.textContent = "Uploading video to FastAPI server...";

  uploadStatusEl.textContent = "Uploading video...";
  uploadStatusEl.className = "text-xs text-cyan-300 font-semibold";

  detectedViolationsSection.classList.add("hidden");

  try {
    // 1. Upload Video
    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("analysis_type", activeMode);

    if (activeMode === "RED_SIGNAL" && activeCalibration.stop_line && activeCalibration.traffic_light_roi) {
      formData.append("calibration_json", JSON.stringify(activeCalibration));
    } else if (activeMode === "SPEED" && activeSpeedCalibration.line_a && activeSpeedCalibration.line_b) {
      formData.append("calibration_json", JSON.stringify(activeSpeedCalibration));
    }

    const uploadRes = await fetch(`${API_BASE}/api/upload`, {
      method: "POST",
      body: formData,
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.json().catch(() => ({}));
      throw new Error(err.detail || `Upload failed: HTTP ${uploadRes.status}`);
    }

    const uploadData = await uploadRes.json();
    const videoId = uploadData.video_id;
    currentVideoId = videoId;

    // Explicitly persist calibration to dedicated endpoint
    if (activeMode === "RED_SIGNAL" && activeCalibration.stop_line && activeCalibration.traffic_light_roi) {
      try {
        await saveCalibration(videoId, activeCalibration);
        console.log(`[CALIBRATION SAVED] Video ${videoId}:`, activeCalibration);
      } catch (calibErr) {
        console.warn("Could not save calibration via dedicated endpoint:", calibErr);
      }
    } else if (activeMode === "SPEED" && activeSpeedCalibration.line_a && activeSpeedCalibration.line_b) {
      try {
        await saveCalibration(videoId, activeSpeedCalibration);
        console.log(`[CALIBRATION SAVED] Speed Video ${videoId}:`, activeSpeedCalibration);
      } catch (calibErr) {
        console.warn("Could not save speed calibration via dedicated endpoint:", calibErr);
      }
    }

    // 2. Trigger AI Processing
    startBtn.textContent = "STARTING AI...";
    processingStatusDetail.textContent = `Starting AI ${getModuleName(activeMode)} pipeline...`;

    const processRes = await fetch(`${API_BASE}/api/process/${videoId}`, {
      method: "POST",
    });

    if (!processRes.ok) {
      const err = await processRes.json().catch(() => ({}));
      throw new Error(err.detail || `Processing request failed: HTTP ${processRes.status}`);
    }

    // 3. Poll Real Status
    pollProcessingStatus(videoId, activeMode);

  } catch (err) {
    console.error("Detection initiation error:", err);
    processingBox.classList.add("hidden");
    uploadStatusEl.textContent = `Error: ${err.message}`;
    uploadStatusEl.className = "text-xs text-red-400 font-semibold";
    alert(`Could not start detection: ${err.message}`);
    resetStartButtonAfterFinish();
  }
}

function pollProcessingStatus(videoId, analysisMode) {
  if (pollInterval) clearInterval(pollInterval);

  pollInterval = setInterval(async () => {
    try {
      const statusRes = await fetch(`${API_BASE}/api/status/${videoId}`);
      if (!statusRes.ok) {
        throw new Error(`Status check returned HTTP ${statusRes.status}`);
      }

      const statusData = await statusRes.json();
      const { status, progress, error, violations } = statusData;

      if (status === "PROCESSING") {
        const pct = Math.min(99, progress || 0);
        progressBarFill.style.width = `${pct}%`;
        progressPercentageLabel.textContent = `Progress: ${pct}%`;
        
        let detailText = `Running YOLOv8, ByteTrack and ${getModuleName(analysisMode)}...`;
        if (statusData.current_frame && statusData.total_frames) {
          detailText = `Processed frames: ${statusData.current_frame} / ${statusData.total_frames}`;
          if (statusData.processing_fps) {
            detailText += ` • ${statusData.processing_fps} FPS`;
          }
        }
        processingStatusDetail.textContent = detailText;
        startBtn.textContent = `PROCESSING ${pct}%`;
      } else if (status === "COMPLETED") {
        clearInterval(pollInterval);
        pollInterval = null;

        progressBarFill.style.width = "100%";
        progressPercentageLabel.textContent = "Progress: 100%";
        processingStatusDetail.textContent = "Analysis Complete!";

        uploadStatusEl.textContent = `✓ Analysis Complete (${violations} violation(s) identified)`;
        uploadStatusEl.className = "text-xs text-emerald-400 font-semibold";

        startBtn.textContent = "ANALYSIS COMPLETE";

        // Load Real Result Video & Real Violations
        await renderProcessingResults(videoId, analysisMode);
        resetStartButtonAfterFinish();

      } else if (status === "FAILED") {
        clearInterval(pollInterval);
        pollInterval = null;

        processingBox.classList.add("hidden");
        const errMsg = error || "Unknown processing error";
        uploadStatusEl.textContent = `Processing Failed: ${errMsg}`;
        uploadStatusEl.className = "text-xs text-red-400 font-semibold";
        alert(`Server Processing Failure: ${errMsg}`);
        resetStartButtonAfterFinish();
      }
    } catch (err) {
      console.error("Polling error:", err);
      clearInterval(pollInterval);
      pollInterval = null;
      processingBox.classList.add("hidden");
      uploadStatusEl.textContent = `Polling Error: ${err.message}`;
      uploadStatusEl.className = "text-xs text-red-400 font-semibold";
      resetStartButtonAfterFinish();
    }
  }, 1000);
}

function resetStartButtonAfterFinish() {
  if (!startBtn) return;
  startBtn.disabled = false;
  const label = startBtn.dataset.label || "START DETECTION";
  const theme = startBtn.dataset.theme || "bg-cyan-600 hover:bg-cyan-500 text-white";
  startBtn.textContent = label;
  startBtn.className = `px-10 py-4 rounded-2xl ${theme} font-title text-xs sm:text-sm font-black uppercase tracking-wider transition-all duration-300 cursor-pointer shadow-lg`;
}

// =====================================================================
// Render Processing Results (Video + Violations)
// =====================================================================

async function renderProcessingResults(videoId, analysisMode) {
  try {
    // 1. Fetch Result Video
    const res = await fetch(`${API_BASE}/api/result/${videoId}`);
    if (!res.ok) {
      throw new Error(`Could not fetch result: HTTP ${res.status}`);
    }
    const resultData = await res.json();
    const finalVideoUrl = resultData.video_url.startsWith("http")
      ? resultData.video_url
      : `${API_BASE}${resultData.video_url}`;

    // Mark processed result video loaded and clear preview overlay so we don't double-draw
    isResultVideoLoaded = true;
    clearOverlayCanvas();

    // Load REAL processed annotated video into the SAME player in the workspace box
    moduleVideoPlayer.src = finalVideoUrl;
    moduleVideoPlayer.load();

    if (videoStatusIndicator) {
      videoStatusIndicator.textContent = `AI ANNOTATED VIDEO (${getModuleName(analysisMode).toUpperCase()})`;
      videoStatusIndicator.className = "px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[11px] font-bold shrink-0";
    }
    if (videoMetaTag) {
      videoMetaTag.textContent = "AI Annotated Output (H.264 MP4)";
    }

    // 2. Fetch Violations Specifically for THIS Video ID
    await loadViolationsForVideo(videoId, analysisMode);

    // Scroll to results smoothly
    if (videoWorkspaceBox) {
      videoWorkspaceBox.scrollIntoView({ behavior: "smooth" });
    }

  } catch (err) {
    console.error("Error loading results:", err);
    alert(`Could not display analysis results: ${err.message}`);
  }
}

// =====================================================================
// Render Real Violation Cards for a Given Video ID
// =====================================================================

async function loadViolationsForVideo(videoId, analysisMode) {
  if (!violationsCardsContainer) return;

  violationsCardsContainer.innerHTML = `
    <div class="glass p-8 rounded-2xl text-center text-cyan-300 text-xs">
      <i class="fas fa-spinner fa-spin mr-2"></i> Loading violation records for this video...
    </div>
  `;
  detectedViolationsSection.classList.remove("hidden");

  try {
    const violations = await getViolations({ video_id: videoId });
    const count = violations.length;

    violationsHeaderTitle.textContent = `DETECTED VIOLATIONS — ${count}`;
    violationsCountTag.textContent = `${count} Record${count === 1 ? "" : "s"}`;

    if (!violations || violations.length === 0) {
      violationsCardsContainer.innerHTML = `
        <div class="glass p-8 rounded-2xl text-center border border-white/10 space-y-1">
          <div class="text-emerald-400 text-base font-bold">✓ Analysis Complete</div>
          <div class="text-slate-300 text-xs">0 Violations Detected</div>
        </div>
      `;
      return;
    }

    violationsCardsContainer.innerHTML = "";
    violations.forEach((v, idx) => {
      const card = createViolationCardElement(v, idx + 1, () => loadViolationsForVideo(videoId, analysisMode));
      violationsCardsContainer.appendChild(card);
    });

  } catch (err) {
    console.error("Failed to load violations for video:", err);
    violationsCardsContainer.innerHTML = `
      <div class="glass p-8 rounded-2xl text-center text-red-400 text-xs">
        Failed to fetch violation records: ${err.message}
      </div>
    `;
  }
}

// =====================================================================
// Create Violation Card Element (Section 15 Layout)
// =====================================================================

function createViolationCardElement(v, indexNumber, onStatusChanged) {
  const card = document.createElement("div");
  const isSpeeding = (v.violation_type === "SPEEDING");
  const isNoHelmet = (v.violation_type === "NO_HELMET");

  let borderColor = "border-red-500/40 hover:border-red-500/70";
  let titleColor = "text-red-400";
  let titleText = `🚨 RED SIGNAL VIOLATION #${indexNumber}`;

  if (isSpeeding) {
    borderColor = "border-amber-500/40 hover:border-amber-500/70";
    titleColor = "text-amber-400";
    titleText = `🏎️ SPEED VIOLATION #${indexNumber}`;
  } else if (isNoHelmet) {
    borderColor = "border-yellow-400/40 hover:border-yellow-400/70";
    titleColor = "text-yellow-400";
    titleText = `🪖 NO HELMET VIOLATION #${indexNumber}`;
  }

  card.className = `glass p-6 rounded-3xl border ${borderColor} transition-all duration-300`;
  card.id = `viol-card-${v.violation_id}`;

  // Evidence screenshot URL (strictly from backend evidence)
  const evidenceUrl = v.evidence_image
    ? (v.evidence_image.startsWith("http") ? v.evidence_image : `${API_BASE}${v.evidence_image}`)
    : null;

  const vehicleUrl = v.vehicle_crop
    ? (v.vehicle_crop.startsWith("http") ? v.vehicle_crop : `${API_BASE}${v.vehicle_crop}`)
    : null;

  const plateUrl = v.plate_crop
    ? (v.plate_crop.startsWith("http") ? v.plate_crop : `${API_BASE}${v.plate_crop}`)
    : null;

  const isPending = (v.status === "PENDING");
  const isApproved = (v.status === "APPROVED");

  let statusBadge = `<span class="px-3 py-1 rounded-full text-xs font-bold font-mono bg-slate-500/20 text-slate-300 border border-slate-500/30">REJECTED</span>`;
  if (isPending) {
    statusBadge = `<span class="px-3 py-1 rounded-full text-xs font-bold font-mono bg-yellow-500/20 text-yellow-300 border border-yellow-500/40">PENDING</span>`;
  } else if (isApproved) {
    statusBadge = `<span class="px-3 py-1 rounded-full text-xs font-bold font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">APPROVED</span>`;
  }

  const plateDisplay = (!v.plate_number || v.plate_number === "Not Detected")
    ? `<span class="text-slate-400 italic font-mono">Not Detected</span>`
    : `<span class="text-cyan-300 font-mono font-bold tracking-wider text-base">${v.plate_number}</span>`;

  // Module Specific Details
  let moduleSpecificHtml = "";
  if (isSpeeding) {
    moduleSpecificHtml = `
      <div class="grid grid-cols-3 gap-2 p-2.5 rounded-xl bg-black/30 border border-white/5 font-mono text-xs">
        <div><span class="text-slate-400 block text-[10px]">DETECTED SPEED</span> <b class="text-amber-400 text-sm">${v.detected_speed_kmh} km/h</b></div>
        <div><span class="text-slate-400 block text-[10px]">SPEED LIMIT</span> <b class="text-slate-200">${v.speed_limit_kmh} km/h</b></div>
        <div><span class="text-slate-400 block text-[10px]">EXCESS SPEED</span> <b class="text-red-400 font-bold">+${v.speed_excess_kmh} km/h</b></div>
      </div>
    `;
  } else if (isNoHelmet) {
    const hConf = v.helmet_confidence ? `${(v.helmet_confidence * 100).toFixed(0)}%` : "80%";
    moduleSpecificHtml = `
      <div class="grid grid-cols-2 gap-2 p-2.5 rounded-xl bg-black/30 border border-white/5 font-mono text-xs">
        <div><span class="text-slate-400 block text-[10px]">HELMET STATUS</span> <b class="text-red-400">NO HELMET</b></div>
        <div><span class="text-slate-400 block text-[10px]">HELMET CONFIDENCE</span> <b class="text-yellow-300">${hConf}</b></div>
      </div>
    `;
  } else {
    moduleSpecificHtml = `
      <div class="p-2 rounded-xl bg-black/30 border border-white/5 font-mono text-xs">
        <span class="text-slate-400">SIGNAL STATE:</span> <b class="text-red-400 uppercase font-bold ml-1">${v.traffic_light_state || 'RED'}</b>
      </div>
    `;
  }

  const reasonString = v.reason || (
    isSpeeding
      ? "Vehicle exceeded the configured speed limit."
      : (isNoHelmet ? "Motorcycle rider detected without a protective helmet." : "Vehicle crossed the configured stop line while the traffic signal was RED.")
  );

  const confPercent = v.detection_confidence ? `${(v.detection_confidence * 100).toFixed(0)}%` : "N/A";

  card.innerHTML = `
    <!-- Card Header -->
    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3 mb-4">
      <div class="flex items-center gap-3">
        <span class="${titleColor} font-title font-black text-sm sm:text-base tracking-wide">
          ${titleText}
        </span>
        <span class="text-xs px-2.5 py-0.5 rounded-full bg-white/10 text-slate-300 font-mono">
          Track #${v.track_id}
        </span>
      </div>
      <div>
        ${statusBadge}
      </div>
    </div>

    <!-- Desktop: Side-by-side (Image on Left, Details on Right) / Mobile: Stacked -->
    <div class="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">

      <!-- LEFT: REAL EVIDENCE SCREENSHOT -->
      <div class="md:col-span-5 lg:col-span-5 space-y-2">
        <div class="text-[11px] font-bold text-slate-400 uppercase font-mono flex items-center justify-between">
          <span>Real Evidence Screenshot</span>
          <span class="text-cyan-400 text-[10px]"><i class="fas fa-search-plus"></i> Click to enlarge</span>
        </div>

        ${evidenceUrl ? `
          <a href="${evidenceUrl}" target="_blank" title="Click to view full-resolution evidence">
            <img src="${evidenceUrl}" class="rounded-2xl w-full h-56 sm:h-64 object-cover border border-white/20 hover:border-cyan-400 transition-all duration-300 shadow-xl" />
          </a>
        ` : `<div class="h-56 rounded-2xl bg-black/60 flex items-center justify-center text-xs text-slate-500">No Image Available</div>`}

        <!-- Small Crops Preview (Vehicle Crop + Plate Crop) -->
        <div class="grid grid-cols-2 gap-2 pt-1">
          ${vehicleUrl ? `
            <div>
              <div class="text-[9px] text-slate-400 uppercase mb-0.5">Vehicle Crop</div>
              <a href="${vehicleUrl}" target="_blank">
                <img src="${vehicleUrl}" class="rounded-xl w-full h-16 object-cover border border-white/10 hover:border-cyan-400 transition" />
              </a>
            </div>
          ` : `<div></div>`}

          ${plateUrl ? `
            <div>
              <div class="text-[9px] text-slate-400 uppercase mb-0.5">Plate Crop</div>
              <a href="${plateUrl}" target="_blank">
                <img src="${plateUrl}" class="rounded-xl w-full h-16 object-contain bg-black/80 border border-white/10 hover:border-cyan-400 transition p-1" />
              </a>
            </div>
          ` : `<div></div>`}
        </div>
      </div>

      <!-- RIGHT: INFORMATION DETAILS & HUMAN VERIFICATION -->
      <div class="md:col-span-7 lg:col-span-7 space-y-3.5">

        <div class="space-y-2 text-xs">
          <div class="flex items-center justify-between p-2.5 rounded-xl bg-black/20 border border-white/5">
            <span class="text-slate-400 font-semibold">Vehicle Number:</span>
            <div>${plateDisplay}</div>
          </div>

          <div class="flex items-center justify-between p-2.5 rounded-xl bg-black/20 border border-white/5">
            <span class="text-slate-400 font-semibold">Vehicle Type:</span>
            <span class="font-bold text-slate-200 uppercase">${v.vehicle_class || 'Vehicle'}</span>
          </div>

          <div class="flex items-center justify-between p-2.5 rounded-xl bg-black/20 border border-white/5 font-mono">
            <span class="text-slate-400 font-semibold">Violation Time:</span>
            <span class="text-cyan-300 font-bold">${formatTimestamp(v.video_timestamp_seconds)} (Frame ${v.frame_number})</span>
          </div>

          <div class="flex items-center justify-between p-2.5 rounded-xl bg-black/20 border border-white/5 font-mono">
            <span class="text-slate-400 font-semibold">Detection Confidence:</span>
            <span class="text-slate-200 font-bold">${confPercent}</span>
          </div>
        </div>

        <!-- Module Specific Information -->
        ${moduleSpecificHtml}

        <!-- Violation Reason -->
        <div class="p-3 rounded-xl bg-black/20 border border-white/5 text-xs">
          <span class="text-slate-400 font-semibold block mb-0.5">Reason:</span>
          <span class="text-slate-200 leading-relaxed">${reasonString}</span>
        </div>

        <!-- Human Verification Controls -->
        <div class="pt-3 border-t border-white/10 flex flex-wrap items-center justify-between gap-3">
          <div class="text-xs">
            <span class="text-slate-400">Verification:</span>
            <span class="font-bold font-mono ml-1 ${v.status === 'APPROVED' ? 'text-emerald-400' : (v.status === 'REJECTED' ? 'text-slate-400' : 'text-yellow-400')}">
              ${v.status}
            </span>
          </div>

          <div class="flex items-center gap-2">
            ${isPending ? `
              <button class="btn-approve-${v.violation_id} px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-title font-bold text-xs uppercase tracking-wider transition cursor-pointer shadow-lg shadow-emerald-600/20">
                <i class="fas fa-check mr-1.5"></i> APPROVE
              </button>
              <button class="btn-reject-${v.violation_id} px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-title font-bold text-xs uppercase tracking-wider transition cursor-pointer shadow-lg shadow-red-600/20">
                <i class="fas fa-times mr-1.5"></i> REJECT
              </button>
            ` : `
              <span class="text-xs text-slate-400 italic">
                Reviewed ${v.reviewed_at ? new Date(v.reviewed_at).toLocaleTimeString() : ''}
              </span>
            `}
          </div>
        </div>

      </div>

    </div>
  `;

  // Attach Approve & Reject Listeners
  if (isPending) {
    const btnApp = card.querySelector(`.btn-approve-${v.violation_id}`);
    const btnRej = card.querySelector(`.btn-reject-${v.violation_id}`);

    if (btnApp) {
      btnApp.onclick = async () => {
        btnApp.disabled = true;
        try {
          await approveViolation(v.violation_id);
          if (onStatusChanged) onStatusChanged();
        } catch (err) {
          alert(`Approval failed: ${err.message}`);
          btnApp.disabled = false;
        }
      };
    }

    if (btnRej) {
      btnRej.onclick = async () => {
        btnRej.disabled = true;
        try {
          await rejectViolation(v.violation_id);
          if (onStatusChanged) onStatusChanged();
        } catch (err) {
          alert(`Rejection failed: ${err.message}`);
          btnRej.disabled = false;
        }
      };
    }
  }

  return card;
}

// =====================================================================
// Separate History Page Management
// =====================================================================

export function filterHistory(analysisType) {
  activeHistoryTab = analysisType;

  // Update Category Tab Styling
  const tabRed = document.getElementById("hist-tab-red");
  const tabSpeed = document.getElementById("hist-tab-speed");
  const tabHelmet = document.getElementById("hist-tab-helmet");

  const activeRed = "px-5 py-2.5 rounded-xl transition cursor-pointer bg-red-600/30 text-red-200 border border-red-500/50 shadow-lg";
  const activeSpeed = "px-5 py-2.5 rounded-xl transition cursor-pointer bg-amber-600/30 text-amber-200 border border-amber-500/50 shadow-lg";
  const activeHelmet = "px-5 py-2.5 rounded-xl transition cursor-pointer bg-yellow-500/30 text-yellow-200 border border-yellow-400/50 shadow-lg";
  const inactive = "px-5 py-2.5 rounded-xl transition cursor-pointer text-slate-300 border border-transparent hover:text-white";

  if (tabRed) tabRed.className = (analysisType === "RED_SIGNAL") ? activeRed : inactive;
  if (tabSpeed) tabSpeed.className = (analysisType === "SPEED") ? activeSpeed : inactive;
  if (tabHelmet) tabHelmet.className = (analysisType === "NO_HELMET") ? activeHelmet : inactive;

  loadHistoryData(analysisType);
}
window.filterHistory = filterHistory;

export async function loadHistoryData(analysisType) {
  if (!historyListContainer) return;

  historyListContainer.innerHTML = `
    <div class="glass p-8 rounded-3xl text-center text-cyan-300 text-xs">
      <i class="fas fa-spinner fa-spin mr-2"></i> Loading historical analyses from database...
    </div>
  `;

  try {
    const records = await getHistory(analysisType);

    if (!records || records.length === 0) {
      historyListContainer.innerHTML = `
        <div class="glass p-12 rounded-3xl text-center border border-white/10 space-y-2">
          <div class="text-slate-400 text-sm">No analysis records found for this module.</div>
          <div class="text-slate-500 text-xs">Upload and analyze videos in the ${getModuleName(analysisType)} to see them here.</div>
        </div>
      `;
      return;
    }

    historyListContainer.innerHTML = "";
    records.forEach((item) => {
      const card = createHistoryItemCard(item);
      historyListContainer.appendChild(card);
    });

  } catch (err) {
    console.error("Failed to load history:", err);
    historyListContainer.innerHTML = `
      <div class="glass p-8 rounded-3xl text-center text-red-400 text-xs">
        Failed to fetch history: ${err.message}
      </div>
    `;
  }
}

function createHistoryItemCard(item) {
  const card = document.createElement("div");
  card.className = "glass p-5 rounded-2xl border border-white/10 hover:border-cyan-400/40 transition flex flex-wrap items-center justify-between gap-4";

  const dateStr = item.created_at ? new Date(item.created_at).toLocaleString() : "N/A";
  const isCompleted = (item.status === "COMPLETED");

  let moduleBadge = `<span class="px-2.5 py-1 rounded-full text-[11px] font-bold font-mono bg-red-500/20 text-red-300 border border-red-500/40">🚦 RED SIGNAL</span>`;
  if (item.analysis_type === "SPEED") {
    moduleBadge = `<span class="px-2.5 py-1 rounded-full text-[11px] font-bold font-mono bg-amber-500/20 text-amber-300 border border-amber-500/40">🏎️ SPEED</span>`;
  } else if (item.analysis_type === "NO_HELMET") {
    moduleBadge = `<span class="px-2.5 py-1 rounded-full text-[11px] font-bold font-mono bg-yellow-500/20 text-yellow-300 border border-yellow-500/40">🪖 NO HELMET</span>`;
  }

  const statusColor = isCompleted
    ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
    : (item.status === "FAILED" ? "bg-red-500/20 text-red-300 border-red-500/30" : "bg-yellow-500/20 text-yellow-300 border-yellow-500/30");

  card.innerHTML = `
    <div class="flex items-center gap-4">
      <div class="w-12 h-12 rounded-xl bg-black/40 border border-white/10 flex items-center justify-center text-xl text-cyan-400">
        <i class="fas fa-film"></i>
      </div>
      <div>
        <div class="font-mono text-sm font-bold text-white flex items-center gap-2">
          <span>${item.filename}</span>
          ${moduleBadge}
        </div>
        <div class="text-xs text-slate-400 mt-1 flex flex-wrap items-center gap-3">
          <span><i class="fas fa-calendar-alt mr-1"></i> ${dateStr}</span>
          <span class="px-2 py-0.5 rounded-full border text-[10px] font-bold font-mono ${statusColor}">${item.status}</span>
          <span class="font-mono font-bold ${item.violations_count > 0 ? 'text-red-400' : 'text-emerald-400'}">
            ${item.violations_count} Violation${item.violations_count === 1 ? '' : 's'}
          </span>
        </div>
      </div>
    </div>

    <div>
      ${isCompleted ? `
        <button class="btn-view-analysis px-5 py-2.5 rounded-xl bg-cyan-600/30 hover:bg-cyan-600 text-cyan-200 hover:text-white border border-cyan-400/50 font-title font-bold text-xs uppercase tracking-wider transition cursor-pointer flex items-center gap-2 shadow-lg shadow-cyan-600/10">
          <i class="fas fa-play"></i> <span>View Analysis</span>
        </button>
      ` : `<span class="text-xs text-slate-500 italic">Processing Incomplete</span>`}
    </div>
  `;

  const viewBtn = card.querySelector(".btn-view-analysis");
  if (viewBtn) {
    viewBtn.onclick = () => {
      openAnalysisFromHistory(item);
    };
  }

  return card;
}

// =====================================================================
// View Analysis from History
// =====================================================================

export async function openAnalysisFromHistory(item) {
  // 1. Switch to Module Workspace
  await openModule(item.analysis_type || "RED_SIGNAL");

  // Mark historical analysis as loaded and clear preview overlay
  isResultVideoLoaded = true;
  clearOverlayCanvas();

  // If RED_SIGNAL or SPEED, retrieve and display historical calibration
  if ((item.analysis_type || "RED_SIGNAL") === "RED_SIGNAL") {
    if (item.calibration && item.calibration.stop_line) {
      activeCalibration = item.calibration;
    } else {
      try {
        const calibRes = await getCalibration(item.video_id);
        if (calibRes && calibRes.calibration) {
          activeCalibration = calibRes.calibration;
        }
      } catch (e) {
        console.warn("Could not fetch calibration for history video:", e);
      }
    }
    updateCalibrationUI();
  } else if (item.analysis_type === "SPEED") {
    if (item.calibration && item.calibration.line_a) {
      activeSpeedCalibration = {
        line_a: item.calibration.line_a,
        line_b: item.calibration.line_b,
        distance_meters: item.calibration.distance_meters ?? 10.0,
        speed_limit_kmh: item.calibration.speed_limit_kmh ?? 60.0
      };
    } else {
      try {
        const calibRes = await getCalibration(item.video_id);
        if (calibRes && calibRes.calibration) {
          activeSpeedCalibration = {
            line_a: calibRes.calibration.line_a,
            line_b: calibRes.calibration.line_b,
            distance_meters: calibRes.calibration.distance_meters ?? 10.0,
            speed_limit_kmh: calibRes.calibration.speed_limit_kmh ?? 60.0
          };
        }
      } catch (e) {
        console.warn("Could not fetch calibration for history speed video:", e);
      }
    }
    if (speedDistanceInput) speedDistanceInput.value = activeSpeedCalibration.distance_meters;
    if (speedLimitInput) speedLimitInput.value = activeSpeedCalibration.speed_limit_kmh;
    updateCalibrationUI();
  }

  // 2. Setup Unified Video Box for Historical Display
  if (dropZone) dropZone.classList.add("hidden");
  if (videoPreviewWrapper) videoPreviewWrapper.classList.remove("hidden");
  if (videoWorkspaceBox) {
    videoWorkspaceBox.className = "rounded-2xl border border-indigo-500/40 bg-black/60 shadow-2xl overflow-hidden relative";
  }

  if (selectedFileNameEl) selectedFileNameEl.textContent = item.filename || "historical_video.mp4";
  if (selectedFileSizeEl) selectedFileSizeEl.textContent = "Archived Video";

  if (videoStatusIndicator) {
    videoStatusIndicator.textContent = `HISTORICAL VIDEO: ${item.filename || 'ARCHIVED'}`;
    videoStatusIndicator.className = "px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 text-[11px] font-bold shrink-0";
  }

  if (videoMetaTag) {
    videoMetaTag.textContent = "Historical AI Annotated Output (H.264 MP4)";
  }

  // 3. Load Processed Video
  if (item.video_url) {
    const finalVideoUrl = item.video_url.startsWith("http")
      ? item.video_url
      : `${API_BASE}${item.video_url}`;
    moduleVideoPlayer.src = finalVideoUrl;
    moduleVideoPlayer.load();
  }

  // 4. Load Violations Specifically for This Historical Video
  await loadViolationsForVideo(item.video_id, item.analysis_type);

  // 5. Scroll to Video & Violations
  if (videoWorkspaceBox) {
    videoWorkspaceBox.scrollIntoView({ behavior: "smooth" });
  }
}

// =====================================================================
// Helpers
// =====================================================================

function getModuleName(mode) {
  if (mode === "SPEED") return "Speed Violation";
  if (mode === "NO_HELMET") return "No-Helmet";
  return "Red Signal";
}

function formatTimestamp(seconds) {
  if (seconds === undefined || seconds === null || isNaN(seconds)) {
    return "00:00.0";
  }
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(1);
  const formattedMins = mins.toString().padStart(2, "0");
  const formattedSecs = (secs < 10 ? "0" : "") + secs;
  return `${formattedMins}:${formattedSecs}`;
}

// =====================================================================
// Application Bootstrap
// =====================================================================

window.addEventListener("DOMContentLoaded", () => {
  // Check backend health & preload road configuration
  const statusBadge = document.getElementById("backend-status-badge");
  getHealth()
    .then(() => {
      if (statusBadge) {
        statusBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> Online`;
        statusBadge.className = "hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full glass-subtle text-[11px] text-emerald-400 font-mono border border-emerald-500/20 ml-2";
      }
    })
    .catch((e) => {
      console.warn("Backend health check:", e);
      if (statusBadge) {
        statusBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-red-400"></span> Offline`;
        statusBadge.className = "hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full glass-subtle text-[11px] text-red-400 font-mono border border-red-500/20 ml-2";
      }
    });

  getConfig().then((cfg) => { roadConfigCache = cfg; }).catch(() => {});

  // Show Home view by default
  showView("home");
});