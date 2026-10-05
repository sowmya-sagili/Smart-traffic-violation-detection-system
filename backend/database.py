from datetime import datetime, timezone
from typing import Optional, Dict, Any, List
import pymongo
from pymongo import MongoClient, ASCENDING, DESCENDING
from pymongo.errors import PyMongoError, ConnectionFailure

from config import MONGO_URI, MONGO_DB_NAME

_client: Optional[MongoClient] = None
_db = None


def get_db():
    """
    Initializes and returns the PyMongo database instance with connection pooling.
    """
    global _client, _db
    if _db is not None:
        return _db

    try:
        _client = MongoClient(
            MONGO_URI,
            serverSelectionTimeoutMS=3000,
            connectTimeoutMS=3000,
            socketTimeoutMS=5000,
            maxPoolSize=50
        )
        # Test connection
        _client.admin.command("ping")
        _db = _client[MONGO_DB_NAME]
        _init_indexes(_db)
        return _db
    except ConnectionFailure as e:
        print(f"Warning: Failed to connect to MongoDB at {MONGO_URI}: {e}")
        raise e


def _init_indexes(db):
    """Creates indexes for videos and violations collections."""
    try:
        db.videos.create_index([("video_id", ASCENDING)], unique=True)
        db.videos.create_index([("created_at", DESCENDING)])
        db.videos.create_index([("status", ASCENDING)])

        db.violations.create_index([("violation_id", ASCENDING)], unique=True)
        db.violations.create_index([("video_id", ASCENDING)])
        db.violations.create_index([("status", ASCENDING)])
        db.violations.create_index([("violation_type", ASCENDING)])
        db.violations.create_index([("detected_at", DESCENDING)])
    except Exception as e:
        print(f"Index creation warning: {e}")


def _serialize_doc(doc: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Converts MongoDB BSON types (like ObjectId and datetime) to JSON-serializable types."""
    if not doc:
        return None
    doc = dict(doc)
    if "_id" in doc:
        doc["_id"] = str(doc["_id"])
    for key, val in list(doc.items()):
        if isinstance(val, datetime):
            doc[key] = val.isoformat()
    return doc


# =====================================================================
# Video Documents CRUD
# =====================================================================

def create_video_record(
    video_id: str,
    original_filename: str,
    stored_filename: str,
    input_path: str,
    analysis_type: str = "RED_SIGNAL"
) -> Dict[str, Any]:
    """Creates a new video tracking document in MongoDB."""
    db = get_db()
    now = datetime.now(timezone.utc)
    doc = {
        "video_id": video_id,
        "original_filename": original_filename,
        "stored_filename": stored_filename,
        "input_path": input_path,
        "analysis_type": analysis_type,
        "output_path": None,
        "status": "UPLOADED",
        "progress": 0,
        "total_frames": 0,
        "violations_count": 0,
        "created_at": now,
        "started_at": None,
        "completed_at": None,
        "error": None
    }
    db.videos.insert_one(doc)
    return _serialize_doc(doc)


def get_video_record(video_id: str) -> Optional[Dict[str, Any]]:
    """Retrieves a video document by video_id."""
    db = get_db()
    doc = db.videos.find_one({"video_id": video_id})
    return _serialize_doc(doc)


def update_video_record(video_id: str, update_fields: Dict[str, Any]) -> bool:
    """Updates fields on a video document."""
    db = get_db()
    res = db.videos.update_one({"video_id": video_id}, {"$set": update_fields})
    return res.matched_count > 0


def get_all_video_records(limit: int = 100, analysis_type: Optional[str] = None) -> List[Dict[str, Any]]:
    """Retrieves recent video records sorted by created_at descending with optional analysis_type filter."""
    db = get_db()
    query = {}
    if analysis_type:
        query["analysis_type"] = analysis_type.upper().strip()
    cursor = db.videos.find(query).sort("created_at", DESCENDING).limit(limit)
    return [_serialize_doc(d) for d in cursor]


# =====================================================================
# Violation Documents CRUD
# =====================================================================

def create_violation_record(data: Dict[str, Any]) -> Dict[str, Any]:
    """Inserts a real violation document into MongoDB."""
    db = get_db()
    doc = dict(data)
    if "detected_at" not in doc or doc["detected_at"] is None:
        doc["detected_at"] = datetime.now(timezone.utc)
    if "status" not in doc:
        doc["status"] = "PENDING"
    if "reviewed_at" not in doc:
        doc["reviewed_at"] = None

    db.violations.insert_one(doc)
    return _serialize_doc(doc)


def get_violation_record(violation_id: str) -> Optional[Dict[str, Any]]:
    """Retrieves a single violation record by violation_id."""
    db = get_db()
    doc = db.violations.find_one({"violation_id": violation_id})
    return _serialize_doc(doc)


def get_violations_records(
    video_id: Optional[str] = None,
    status: Optional[str] = None,
    violation_type: Optional[str] = None,
    limit: int = 200
) -> List[Dict[str, Any]]:
    """Queries violation records with optional filtering."""
    db = get_db()
    query = {}
    if video_id:
        query["video_id"] = video_id
    if status:
        query["status"] = status.upper()
    if violation_type:
        query["violation_type"] = violation_type.upper()

    cursor = db.violations.find(query).sort("detected_at", DESCENDING).limit(limit)
    return [_serialize_doc(d) for d in cursor]


def update_violation_status(violation_id: str, new_status: str) -> Optional[Dict[str, Any]]:
    """
    Updates the review status of a violation (PENDING -> APPROVED or REJECTED)
    and timestamps reviewed_at.
    """
    valid_statuses = {"APPROVED", "REJECTED"}
    upper_status = new_status.upper()
    if upper_status not in valid_statuses:
        raise ValueError(f"Invalid status '{new_status}'. Allowed values: {valid_statuses}")

    db = get_db()
    now = datetime.now(timezone.utc)
    res = db.violations.find_one_and_update(
        {"violation_id": violation_id},
        {"$set": {"status": upper_status, "reviewed_at": now}},
        return_document=pymongo.ReturnDocument.AFTER
    )
    return _serialize_doc(res)


# =====================================================================
# Real Statistics
# =====================================================================

def get_system_statistics() -> Dict[str, int]:
    """Aggregates real statistics across the MongoDB collections."""
    db = get_db()
    total_videos = db.videos.count_documents({})
    total_violations = db.violations.count_documents({})
    red_light_violations = db.violations.count_documents({"violation_type": "RED_LIGHT_JUMP"})
    speeding_violations = db.violations.count_documents({"violation_type": "SPEEDING"})
    no_helmet_violations = db.violations.count_documents({"violation_type": "NO_HELMET"})
    pending = db.violations.count_documents({"status": "PENDING"})
    approved = db.violations.count_documents({"status": "APPROVED"})
    rejected = db.violations.count_documents({"status": "REJECTED"})

    return {
        "total_videos": int(total_videos),
        "total_violations": int(total_violations),
        "red_light_violations": int(red_light_violations),
        "speeding_violations": int(speeding_violations),
        "no_helmet_violations": int(no_helmet_violations),
        "pending": int(pending),
        "approved": int(approved),
        "rejected": int(rejected)
    }
