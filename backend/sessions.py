from datetime import datetime, timedelta
import secrets
import pytz
from fastapi import HTTPException

# Timezone setup (Kolkata)
kolkata_tz = pytz.timezone("Asia/Kolkata")
utc_tz = pytz.UTC

# Session validity duration
SESSION_DURATION = timedelta(days=7)

# ====================================
# CREATE OR REUSE SESSION
# ====================================
async def create_session(sessions_collection, user_email: str, device_info: str, user_data: dict):
    """
    Create or reuse a session for this user and device.
    All timestamps stored as UTC to avoid tz conflicts.
    """
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
            print(f"[SESSION] Expired & removed for {user_email}:{device_info[:40]}")
        else:
            new_expiry = now + SESSION_DURATION
            await sessions_collection.update_one(
                {"_id": existing["_id"]},
                {"$set": {"expiry": new_expiry, "last_accessed": now}},
            )
            print(f"[SESSION] Reused for {user_email}:{device_info[:40]}")
            return existing["session_id"]

    # Create new session
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
    print(f"[SESSION] Created NEW for {user_email}:{device_info[:40]}")
    return session_id


# ====================================
# GET / VALIDATE SESSION
# ====================================
async def get_session(sessions_collection, session_id: str):
    """
    Retrieve and auto-refresh a session.
    Handles tz-naive vs tz-aware safely.
    """
    session = await sessions_collection.find_one({"session_id": session_id})
    if not session:
        return None

    now = datetime.now(utc_tz)
    expiry = session.get("expiry")

    # Make expiry tz-aware if missing
    if expiry and expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=utc_tz)

    if not expiry or expiry < now:
        await sessions_collection.delete_one({"_id": session["_id"]})
        print(f"[SESSION] Expired -> {session_id}")
        return None

    # Refresh expiry
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
    if result.deleted_count:
        print(f"[SESSION] Deleted -> {session_id}")
        return True
    return False


# ====================================
# CLEANUP EXPIRED SESSIONS
# ====================================
async def cleanup_expired_sessions(sessions_collection):
    now = datetime.now(utc_tz)
    result = await sessions_collection.delete_many({"expiry": {"$lt": now}})
    if result.deleted_count:
        print(f"[SESSION] Cleaned up {result.deleted_count} expired sessions.")


# ====================================
# VERIFY SESSION (for Protected Routes)
# ====================================
async def verify_session(request, sessions_collection):
    """
    Verify Bearer token and return user data if valid.
    """
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid session token")

    session_id = auth_header.split(" ")[1]
    session_data = await get_session(sessions_collection, session_id)

    if not session_data:
        raise HTTPException(status_code=401, detail="Invalid or expired session")

    return session_data
