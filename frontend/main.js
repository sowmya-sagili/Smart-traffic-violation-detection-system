import {
  API_BASE,
  getHealth,
  getConfig,
  getViolations,
  getViolation,
  approveViolation,
  rejectViolation,
  getHistory
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
const redSignalZoneExplanation = document.getElementById("red-signal-zone-explanation");
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

export function clearOverlayCanvas() {
  if (videoOverlayCanvas) {
    const ctx = videoOverlayCanvas.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, videoOverlayCanvas.width, videoOverlayCanvas.height);
    }
  }
  if (redSignalZoneExplanation) {
    redSignalZoneExplanation.classList.add("hidden");
  }
}

export async function drawRedSignalOverlay() {
  // Only draw overlay during PREVIEW in RED_SIGNAL mode before processing is loaded
  if (currentAnalysisMode !== "RED_SIGNAL" || isResultVideoLoaded) {
    clearOverlayCanvas();
    return;
  }

  if (!moduleVideoPlayer || !moduleVideoPlayer.src || moduleVideoPlayer.readyState < 1) {
    return;
  }

  if (!roadConfigCache) {
    try {
      roadConfigCache = await getConfig();
    } catch (e) {
      console.warn("Could not load road config for overlay:", e);
    }
  }

  const geom = getRenderedVideoGeometry(moduleVideoPlayer, videoOverlayCanvas);
  if (!geom) return;

  const ctx = videoOverlayCanvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, geom.canvasW, geom.canvasH);

  // Show the Red Signal Zone explanation below player
  if (redSignalZoneExplanation) {
    redSignalZoneExplanation.classList.remove("hidden");
  }

  // Extract config
  const rawLine = roadConfigCache?.stop_line || roadConfigCache?.red_signal?.stop_line || [[500, 500], [500, 900]];
  const rawRoi = roadConfigCache?.traffic_light_roi || roadConfigCache?.red_signal?.traffic_light_roi || [[50, 50], [150, 200]];

  // 1. Draw STOP LINE
  if (rawLine && rawLine.length >= 2) {
    const p1 = parsePoint(rawLine[0]);
    const p2 = parsePoint(rawLine[1]);

    const x1 = geom.offsetX + p1[0] * geom.scale;
    const y1 = geom.offsetY + p1[1] * geom.scale;
    const x2 = geom.offsetX + p2[0] * geom.scale;
    const y2 = geom.offsetY + p2[1] * geom.scale;

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

    // Red dot indicator inside pill
    ctx.fillStyle = "#ef4444";
    ctx.beginPath();
    ctx.arc(pillX + 9, pillY + pillH / 2, 3.5, 0, Math.PI * 2);
    ctx.fill();

    // Text inside pill
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "middle";
    ctx.fillText(pillText, pillX + 17, pillY + pillH / 2 + 0.5);
    ctx.restore();
  }

  // 2. Draw TRAFFIC LIGHT ROI
  let roiPts = rawRoi;
  if (Array.isArray(roiPts) && roiPts.length > 0 && Array.isArray(roiPts[0]) && Array.isArray(roiPts[0][0])) {
    roiPts = roiPts[0]; // Nested list of ROIs
  }

  if (roiPts && roiPts.length >= 2) {
    const r1 = parsePoint(roiPts[0]);
    const r2 = parsePoint(roiPts[1]);

    const rx1 = geom.offsetX + r1[0] * geom.scale;
    const ry1 = geom.offsetY + r1[1] * geom.scale;
    const rx2 = geom.offsetX + r2[0] * geom.scale;
    const ry2 = geom.offsetY + r2[1] * geom.scale;
    const rw = rx2 - rx1;
    const rh = ry2 - ry1;

    ctx.save();
    // Semi-transparent amber tint so the traffic light remains visible
    ctx.fillStyle = "rgba(245, 158, 11, 0.18)";
    ctx.fillRect(rx1, ry1, rw, rh);

    // Glowing border
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#f59e0b";
    ctx.shadowColor = "rgba(245, 158, 11, 0.85)";
    ctx.shadowBlur = 8;
    ctx.strokeRect(rx1, ry1, rw, rh);

    // ROI Label Pill
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
    ctx.textBaseline = "middle";
    ctx.fillText(roiLabel, roiPillX + 8, roiPillY + roiPillH / 2);
    ctx.restore();
  }
}

// Attach overlay event listeners
if (moduleVideoPlayer) {
  moduleVideoPlayer.addEventListener("loadedmetadata", () => {
    if (currentAnalysisMode === "RED_SIGNAL" && !isResultVideoLoaded) {
      drawRedSignalOverlay();
    }
  });

  moduleVideoPlayer.addEventListener("loadeddata", () => {
    if (currentAnalysisMode === "RED_SIGNAL" && !isResultVideoLoaded) {
      drawRedSignalOverlay();
    }
  });
}

window.addEventListener("resize", () => {
  if (currentAnalysisMode === "RED_SIGNAL" && !isResultVideoLoaded) {
    drawRedSignalOverlay();
  }
});

document.addEventListener("fullscreenchange", () => {
  if (currentAnalysisMode === "RED_SIGNAL" && !isResultVideoLoaded) {
    drawRedSignalOverlay();
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
  clearOverlayCanvas();

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
    if (currentAnalysisMode === "RED_SIGNAL") {
      setTimeout(() => {
        drawRedSignalOverlay();
      }, 50);
    }
  } catch (err) {
    console.warn("Could not set local video preview:", err);
  }

  uploadStatusEl.textContent = `Selected: ${file.name} • Ready for analysis.`;
  uploadStatusEl.className = "text-xs text-cyan-300 font-semibold";

  if (detectedViolationsSection) detectedViolationsSection.classList.add("hidden");

  // Enable Start Button
  const label = startBtn.dataset.label || "START DETECTION";
  const theme = startBtn.dataset.theme || "bg-cyan-600 hover:bg-cyan-500 text-white";
  startBtn.textContent = label;
  startBtn.disabled = false;
  startBtn.className = `px-10 py-4 rounded-2xl ${theme} font-title text-xs sm:text-sm font-black uppercase tracking-wider transition-all duration-300 cursor-pointer shadow-lg`;
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
        processingStatusDetail.textContent = `Running YOLOv8, ByteTrack and ${getModuleName(analysisMode)}...`;
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
          <div class="text-slate-300 text-xs">No violations detected in this video.</div>
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
  getHealth().catch((e) => console.warn("Backend health check:", e));
  getConfig().then((cfg) => { roadConfigCache = cfg; }).catch(() => {});

  // Show Home view by default
  showView("home");
});