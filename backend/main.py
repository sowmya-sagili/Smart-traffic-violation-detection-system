import os
import uuid
import shutil
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from config import UPLOADS_DIR, OUTPUTS_DIR, EVIDENCE_DIR
from video_processor import process_video, load_road_config
from database import (
    create_video_record,
    get_video_record,
    update_video_record,
    get_all_video_records,
    create_violation_record,
    get_violation_record,
    get_violations_records,
    update_violation_status,
    get_system_statistics
)

# Ensure required storage directories exist
os.makedirs(UPLOADS_DIR, exist_ok=True)
os.makedirs(OUTPUTS_DIR, exist_ok=True)
os.makedirs(EVIDENCE_DIR, exist_ok=True)

ALLOWED_EXTENSIONS = {".mp4", ".avi", ".mov", ".mkv"}

app = FastAPI(
    title="Smart Traffic Violation Detection API",
    version="1.1.0",
    description="Backend API for AI-based traffic violation detection, evidence capture, OCR, and MongoDB persistence"
)

# Enable CORS for local frontend development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount outputs and evidence static directories
app.mount("/outputs", StaticFiles(directory=OUTPUTS_DIR), name="outputs")
app.mount("/evidence", StaticFiles(directory=EVIDENCE_DIR), name="evidence")


def run_video_processing_task(video_id: str):
    """Background task worker for video processing and database synchronization."""
    doc = get_video_record(video_id)
    if not doc:
        return

    input_path = doc["input_path"]
    output_filename = f"processed_{video_id}.mp4"
    output_path = os.path.join(OUTPUTS_DIR, output_filename)

    def update_progress(pct: int):
        update_video_record(video_id, {"progress": pct})

    try:
        update_video_record(video_id, {
            "status": "PROCESSING",
            "progress": 0,
            "error": None
        })

        road_config = load_road_config()
        analysis_type = doc.get("analysis_type", "RED_SIGNAL")
        result = process_video(
            input_path=input_path,
            output_path=output_path,
            road_config=road_config,
            progress_callback=update_progress,
            video_id=video_id,
            analysis_type=analysis_type
        )

        update_video_record(video_id, {
            "status": "COMPLETED",
            "progress": 100,
            "output_path": output_path,
            "violations_count": result.get("violations", 0),
            "total_frames": result.get("total_frames", 0),
            "completed_at": datetime.now(timezone.utc)
        })

    except Exception as exc:
        print(f"Video processing failed for {video_id}: {exc}")
        update_video_record(video_id, {
            "status": "FAILED",
            "error": str(exc),
            "completed_at": datetime.now(timezone.utc)
        })


# =====================================================================
# Core Health & Processing Endpoints (Preserving Phase 0 Compatibility)
# =====================================================================

@app.get("/api/health")
def health_check():
    """Health check endpoint verifying API and DB connectivity."""
    db_connected = False
    try:
        from database import get_db
        db = get_db()
        db.command("ping")
        db_connected = True
    except Exception as e:
        print(f"Health DB ping error: {e}")

    return {
        "status": "ok",
        "message": "Smart Traffic Violation Detection API is healthy",
        "database_connected": db_connected
    }


@app.get("/api/config")
def get_config():
    """Returns active road and violation configuration."""
    from video_processor import load_road_config
    return load_road_config()


@app.post("/api/upload")
async def upload_video(
    file: UploadFile = File(...),
    analysis_type: str = Form("RED_SIGNAL")
):
    """
    Accepts video upload, validates extension, saves to backend/uploads with UUID,
    and creates persistent video record in MongoDB with specified analysis_type.
    """
    original_filename = file.filename or "video.mp4"
    _, ext = os.path.splitext(original_filename)
    ext = ext.lower()

    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file extension '{ext}'. Allowed formats: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
        )

    norm_analysis_type = str(analysis_type or "RED_SIGNAL").upper().strip()
    if norm_analysis_type not in ("RED_SIGNAL", "SPEED", "NO_HELMET", "ALL"):
        norm_analysis_type = "RED_SIGNAL"

    video_id = str(uuid.uuid4())
    stored_filename = f"{video_id}{ext}"
    input_path = os.path.join(UPLOADS_DIR, stored_filename)

    try:
        with open(input_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save uploaded video: {exc}")
    finally:
        await file.close()

    try:
        create_video_record(
            video_id=video_id,
            original_filename=original_filename,
            stored_filename=stored_filename,
            input_path=input_path,
            analysis_type=norm_analysis_type
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save video record to database: {exc}")

    return {
        "video_id": video_id,
        "filename": original_filename,
        "analysis_type": norm_analysis_type,
        "status": "UPLOADED"
    }


@app.post("/api/process/{video_id}")
def start_processing(video_id: str, background_tasks: BackgroundTasks):
    """
    Initiates asynchronous video processing for the specified video_id using BackgroundTasks.
    """
    doc = get_video_record(video_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Video ID not found")

    if doc["status"] == "PROCESSING":
        return {
            "video_id": video_id,
            "status": "PROCESSING",
            "message": "Video is already being processed"
        }

    update_video_record(video_id, {
        "status": "PROCESSING",
        "progress": 0,
        "started_at": datetime.now(timezone.utc),
        "error": None
    })

    background_tasks.add_task(run_video_processing_task, video_id)

    return {
        "video_id": video_id,
        "status": "PROCESSING",
        "message": "Video processing started in background"
    }


@app.get("/api/status/{video_id}")
def get_status(video_id: str):
    """
    Returns the processing status and progress percentage for the given video_id from MongoDB.
    """
    doc = get_video_record(video_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Video ID not found")

    return {
        "video_id": video_id,
        "status": doc["status"],
        "progress": doc.get("progress", 0),
        "violations": doc.get("violations_count", 0),
        "error": doc.get("error")
    }


@app.get("/api/result/{video_id}")
def get_result(video_id: str):
    """
    Returns the final processed video URL and statistics once processing is COMPLETED.
    """
    doc = get_video_record(video_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Video ID not found")

    if doc["status"] == "FAILED":
        raise HTTPException(status_code=500, detail=f"Processing failed: {doc.get('error')}")

    if doc["status"] != "COMPLETED":
        raise HTTPException(status_code=400, detail=f"Processing not completed yet (current status: {doc['status']})")

    output_path = doc.get("output_path", "")
    output_filename = os.path.basename(output_path) if output_path else f"processed_{video_id}.mp4"

    return {
        "video_id": video_id,
        "video_url": f"/outputs/{output_filename}",
        "violations": doc.get("violations_count", 0),
        "total_frames": doc.get("total_frames", 0)
    }


# =====================================================================
# Phase 1: Violations, History & Statistics APIs
# =====================================================================

@app.get("/api/violations")
def list_violations(
    video_id: Optional[str] = Query(None, description="Filter by video UUID"),
    status: Optional[str] = Query(None, description="Filter by status (PENDING, APPROVED, REJECTED)"),
    violation_type: Optional[str] = Query(None, description="Filter by violation type (e.g. RED_LIGHT_JUMP)")
):
    """Retrieves real persistent violation records from MongoDB."""
    records = get_violations_records(video_id=video_id, status=status, violation_type=violation_type)
    return records


@app.get("/api/violations/{violation_id}")
def get_violation(violation_id: str):
    """Retrieves a single violation record by violation_id UUID."""
    record = get_violation_record(violation_id)
    if not record:
        raise HTTPException(status_code=404, detail=f"Violation ID '{violation_id}' not found")
    return record


@app.patch("/api/violations/{violation_id}/approve")
def approve_violation(violation_id: str):
    """Marks a violation as APPROVED with timestamp."""
    record = get_violation_record(violation_id)
    if not record:
        raise HTTPException(status_code=404, detail=f"Violation ID '{violation_id}' not found")

    updated = update_violation_status(violation_id, "APPROVED")
    return updated


@app.patch("/api/violations/{violation_id}/reject")
def reject_violation(violation_id: str):
    """Marks a violation as REJECTED with timestamp."""
    record = get_violation_record(violation_id)
    if not record:
        raise HTTPException(status_code=404, detail=f"Violation ID '{violation_id}' not found")

    updated = update_violation_status(violation_id, "REJECTED")
    return updated


@app.get("/api/history")
def get_history(analysis_type: Optional[str] = Query(None)):
    """Returns real persistent video processing history from MongoDB."""
    records = get_all_video_records(limit=100, analysis_type=analysis_type)
    formatted = []
    for r in records:
        output_path = r.get("output_path")
        video_url = f"/outputs/{os.path.basename(output_path)}" if output_path else None
        formatted.append({
            "video_id": r["video_id"],
            "filename": r.get("original_filename", "video.mp4"),
            "analysis_type": r.get("analysis_type", "RED_SIGNAL"),
            "status": r.get("status", "UNKNOWN"),
            "progress": r.get("progress", 0),
            "violations_count": r.get("violations_count", 0),
            "created_at": r.get("created_at"),
            "completed_at": r.get("completed_at"),
            "video_url": video_url
        })
    return formatted


@app.get("/api/statistics")
def get_statistics():
    """Returns real database aggregate metrics."""
    return get_system_statistics()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)