from datetime import datetime, timedelta
import secrets
import pytz
from fastapi import HTTPException

# =========================
# Timezone setup
# =========================
kolkata_tz = pytz.timezone("Asia/Kolkata")
utc_tz = pytz.UTC

# =========================
# Admin default permissions
# =========================
DEFAULT_ADMIN_PERMISSIONS = {
    "can_add_employee": False,
    "can_add_attendance": False,
    "can_upload_excel": False,
    "can_manage_holidays": False,
    "can_view_reports": False,
}

# =========================
# Session config
# =========================
SESSION_DURATION = timedelta(days=7)

# ====================================
# CREATE OR REUSE SESSION
# ====================================
async def create_session(sessions_collection, user_email: str, device_info: str, user_data: dict):
    now = datetime.now(utc_tz)
    existing = await sessions_collection.find_one(
        {"data.email": user_email, "device_info": device_info}
    )

    if existing:
        expiry = existing.get("expiry")
        if expiry and expiry.tzinfo is None:
            expiry = expiry.replace(tzinfo=utc_tz)
        if expiry and expiry < now:
            await sessions_collection.delete_one({"_id": existing["_id"]})
        else:
            new_expiry = now + SESSION_DURATION
            await sessions_collection.update_one(
                {"_id": existing["_id"]},
                {"$set": {"expiry": new_expiry, "last_accessed": now}},
            )
            return existing["session_id"]

    session_id = secrets.token_hex(32)
    session_doc = {
        "session_id": session_id,
        "data": user_data,
        "device_info": device_info,
        "created_at": now,
        "last_accessed": now,
        "expiry": now + SESSION_DURATION,
    }

    await sessions_collection.insert_one(session_doc)
    return session_id

# ====================================
# GET / VALIDATE SESSION
# ====================================
async def get_session(sessions_collection, session_id: str):
    session = await sessions_collection.find_one({"session_id": session_id})
    if not session:
        return None

    now = datetime.now(utc_tz)
    expiry = session.get("expiry")
    if expiry and expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=utc_tz)

    if not expiry or expiry < now:
        await sessions_collection.delete_one({"_id": session["_id"]})
        return None

    # Extend session expiry
    await sessions_collection.update_one(
        {"_id": session["_id"]},
        {"$set": {"expiry": now + SESSION_DURATION, "last_accessed": now}},
    )

    return session["data"]

# ====================================
# DELETE SESSION (Manual Logout)
# ====================================
async def delete_session(sessions_collection, session_id: str):
    result = await sessions_collection.delete_one({"session_id": session_id})
    return result.deleted_count > 0

# ====================================
# CLEANUP EXPIRED SESSIONS
# ====================================
async def cleanup_expired_sessions(sessions_collection):
    now = datetime.now(utc_tz)
    await sessions_collection.delete_many({"expiry": {"$lt": now}})

# ====================================
# VERIFY SESSION
# ====================================
async def verify_session(request, sessions_collection):
    """
    Verify session from Authorization header only.
    Returns user_data dict if valid.
    """
    auth_header = request.headers.get("Authorization")
    if not auth_header:
        raise HTTPException(status_code=401, detail="Missing Authorization header")

    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid Authorization header format")

    session_id = auth_header.split("Bearer ")[1].strip()
    if not session_id:
        raise HTTPException(status_code=401, detail="Empty session token")

    session_data = await get_session(sessions_collection, session_id)
    if not session_data:
        raise HTTPException(status_code=401, detail="Invalid or expired session")

    # --- always get latest user record ---
    from app import collection  # same Mongo users collection

    user_doc = await collection.find_one({"email": session_data["email"]})
    if not user_doc:
        raise HTTPException(status_code=401, detail="User not found")

    # merge fresh permissions with session data
    session_data["permissions"] = user_doc.get("permissions") or DEFAULT_ADMIN_PERMISSIONS.copy()

    return session_data
