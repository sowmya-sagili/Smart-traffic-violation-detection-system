/**
 * data.js
 * Primary API client helper for fetching violations, approvals, rejections,
 * video processing history, road config, and system statistics from FastAPI.
 */

export const API_BASE = "http://127.0.0.1:8000";

export async function getHealth() {
  const res = await fetch(`${API_BASE}/api/health`);
  if (!res.ok) {
    throw new Error(`Health check failed: HTTP ${res.status}`);
  }
  return await res.json();
}

export async function getConfig() {
  const res = await fetch(`${API_BASE}/api/config`);
  if (!res.ok) {
    throw new Error(`Config fetch failed: HTTP ${res.status}`);
  }
  return await res.json();
}

export async function saveCalibration(videoId, calibrationData) {
  const res = await fetch(`${API_BASE}/api/calibration/${videoId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(calibrationData),
  });
  if (!res.ok) {
    throw new Error(`Failed to save calibration: HTTP ${res.status}`);
  }
  return await res.json();
}

export async function getCalibration(videoId) {
  const res = await fetch(`${API_BASE}/api/calibration/${videoId}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch calibration: HTTP ${res.status}`);
  }
  return await res.json();
}

export async function getViolations(filters = {}) {
  const params = new URLSearchParams();
  if (filters.video_id) params.append("video_id", filters.video_id);
  if (filters.status) params.append("status", filters.status);
  if (filters.violation_type) params.append("violation_type", filters.violation_type);

  const url = `${API_BASE}/api/violations${params.toString() ? `?${params.toString()}` : ""}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch violations: HTTP ${res.status}`);
  }
  return await res.json();
}

export async function getViolation(violationId) {
  const res = await fetch(`${API_BASE}/api/violations/${violationId}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch violation ${violationId}: HTTP ${res.status}`);
  }
  return await res.json();
}

export async function approveViolation(violationId) {
  const res = await fetch(`${API_BASE}/api/violations/${violationId}/approve`, {
    method: "PATCH",
  });
  if (!res.ok) {
    throw new Error(`Failed to approve violation ${violationId}: HTTP ${res.status}`);
  }
  return await res.json();
}

export async function rejectViolation(violationId) {
  const res = await fetch(`${API_BASE}/api/violations/${violationId}/reject`, {
    method: "PATCH",
  });
  if (!res.ok) {
    throw new Error(`Failed to reject violation ${violationId}: HTTP ${res.status}`);
  }
  return await res.json();
}

export async function getHistory(analysisType = null) {
  const url = analysisType
    ? `${API_BASE}/api/history?analysis_type=${encodeURIComponent(analysisType)}`
    : `${API_BASE}/api/history`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch history: HTTP ${res.status}`);
  }
  return await res.json();
}

export async function getStatistics() {
  const res = await fetch(`${API_BASE}/api/statistics`);
  if (!res.ok) {
    throw new Error(`Failed to fetch statistics: HTTP ${res.status}`);
  }
  return await res.json();
}

export function renderViolationsSummary(violationsCount, analysisType = "RED_SIGNAL") {
  const timeline = document.getElementById("detection-timeline");
  if (!timeline) return;

  const isSpeed = (analysisType === "SPEED");
  const isHelmet = (analysisType === "NO_HELMET");

  if (violationsCount > 0) {
    const typeLabel = isSpeed ? 'Speed' : (isHelmet ? 'No-Helmet' : 'Red Light');
    const icon = isSpeed ? '⚡' : (isHelmet ? '🪖' : '🚨');
    const color = isSpeed ? 'text-amber-400' : (isHelmet ? 'text-yellow-400' : 'text-red-400');
    timeline.innerHTML = `
      <div class="${color} font-bold text-sm">
        ${icon} ${violationsCount} Real ${typeLabel} Violation(s) Recorded & Stored.
      </div>
      <div class="text-white/60 text-xs mt-1">
        Evidence frames, vehicle/rider crops, and OCR plate detections are available below for review.
      </div>
    `;
  } else {
    const safeMsg = isSpeed
      ? 'All tracked vehicles stayed within configured speed limit.'
      : (isHelmet ? 'All detected motorcycle riders were wearing protective helmets.' : 'All tracked vehicles stopped before the stop line during red phase.');
    timeline.innerHTML = `
      <div class="text-green-400 font-semibold text-sm">
        ✅ 0 Violations detected.
      </div>
      <div class="text-white/60 text-xs mt-1">
        ${safeMsg}
      </div>
    `;
  }
}