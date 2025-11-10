from datetime import datetime, timedelta
from fastapi import Request, Response
import pytz
import secrets
import json

# Timezone for Kolkata
kolkata_tz = pytz.timezone("Asia/Kolkata")

# In-memory session store
_sessions = {}     # { session_id: { "data": {...}, "expiry": datetime } }

# Session duration: 7 days
SESSION_DURATION = timedelta(days=7)


# ============================
# Session Management
# ============================
async def create_session(response: Response, user_data: dict):
    """
    Create a new session and store it in memory with a cookie.
    """
    session_id = secrets.token_hex(32)
    expiry = datetime.now(kolkata_tz) + SESSION_DURATION

    _sessions[session_id] = {"data": user_data, "expiry": expiry}

    response.set_cookie(
        key="session_id",
        value=session_id,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=int(SESSION_DURATION.total_seconds()),
    )

    print(f"[SESSION] Created for {user_data.get('email')} -> {session_id}")
    return session_id


async def get_session(request: Request, response: Response = None):
    """
    Retrieve and refresh the session.
    Returns None if the session has expired or is invalid.
    """
    session_id = request.cookies.get("session_id")
    if not session_id or session_id not in _sessions:
        return None

    session = _sessions[session_id]
    now = datetime.now(kolkata_tz)

    # Check expiration
    if session["expiry"] < now:
        print(f"[SESSION] Expired -> {session_id}")
        del _sessions[session_id]
        return None

    # Auto-refresh expiry
    session["expiry"] = now + SESSION_DURATION
    if response:
        response.set_cookie(
            key="session_id",
            value=session_id,
            httponly=True,
            secure=True,
            samesite="lax",
            max_age=int(SESSION_DURATION.total_seconds()),
        )

    return session["data"]


async def delete_session(request: Request, response: Response):
    """
    Clear the user's session and delete cookie.
    """
    session_id = request.cookies.get("session_id")
    if session_id and session_id in _sessions:
        del _sessions[session_id]
        print(f"[SESSION] Deleted -> {session_id}")

    response.delete_cookie("session_id")
    return True


async def cleanup_expired_sessions():
    """
    Optional background task to clean old sessions.
    """
    now = datetime.now(kolkata_tz)
    expired = [sid for sid, s in _sessions.items() if s["expiry"] < now]
    for sid in expired:
        del _sessions[sid]
    if expired:
        print(f"[SESSION] Cleaned up {len(expired)} expired sessions.")
