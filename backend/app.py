from fastapi import FastAPI, Request, HTTPException, WebSocket, WebSocketDisconnect, Response, UploadFile, File
from fastapi.responses import RedirectResponse, JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
from bson import ObjectId
from urllib.parse import urlencode
from pathlib import Path
import tempfile
import time
from datetime import datetime, timedelta
from excelmaker import create_attendance_excel, REGULAR_LEGEND, APPRENTICE_LEGEND
from sessions import create_session, get_session, delete_session, verify_session, cleanup_expired_sessions, DEFAULT_ADMIN_PERMISSIONS
import pandas as pd
import pytz
from pytz import timezone
import httpx
import logging
import os
import json
import calendar
import secrets
from collections import defaultdict
from pymongo.errors import DuplicateKeyError
from typing import List

# ===================================
# Setup
# ===================================
load_dotenv()
app = FastAPI()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# MongoDB setup
MONGO_URI = os.getenv("MONGO_URI")
client = AsyncIOMotorClient(MONGO_URI, tls=True)
db = client["Attendify"]
collection = db["users"]
sessions_collection = db["sessions"]

# Google OAuth credentials
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET")
REDIRECT_URI = os.getenv("REDIRECT_URI")
FRONTEND_URL = os.getenv("FRONTEND_URL")

# Superadmin emails
SUPERADMINS = [email.strip() for email in os.getenv("SUPERADMIN_EMAILS", "").split(",") if email.strip()]

# CORS origins
ALLOWED_ORIGINS = [origin.strip() for origin in os.getenv("ALLOWED_ORIGINS", "*").split(",") if origin.strip()]

# Kolkata timezone
kolkata_tz = pytz.timezone("Asia/Kolkata")

# CORS setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Employee sheet
EMPLOYEE_SHEET = "./ATTENDANCE SHEET MUSTER ROLL OF SSEE SW KGP.xlsx"


# ===================================
# WebSocket Notifications
# ===================================
active_connections: list[WebSocket] = []

async def notify_superadmins(message: dict):
    disconnected = []
    for conn in active_connections:
        try:
            await conn.send_json(message)  # Use JSON for structured messages
        except Exception:
            disconnected.append(conn)
    # Clean up disconnected clients
    for conn in disconnected:
        if conn in active_connections:
            active_connections.remove(conn)


async def auto_notify(request: Request, actor: str, action: str):
    now = datetime.now(kolkata_tz)
    notification = {
        "title": "Unauthorized Action Blocked",
        "message": f"User {actor} attempted to {action}.",
        "timestamp": now.strftime("%d-%m-%Y %H:%M:%S"),
        "status": "unread",
        "expireAt": now + timedelta(days=30)
    }

    result = await db["notifications"].insert_one(notification)
    notification["_id"] = str(result.inserted_id)

    # Push to live superadmins
    await notify_superadmins(notification)

@app.get("/notifications")
async def get_notifications(status: str = None):
    query = {"status": status} if status else {}
    notifications = await db["notifications"].find(query).sort("expireAt", -1).to_list(100)
    for n in notifications:
        n["_id"] = str(n["_id"])
    return notifications

@app.post("/notifications/read/{notification_id}")
async def mark_notification_read(notification_id: str):
    result = await db["notifications"].update_one({"_id": ObjectId(notification_id)}, {"$set": {"status": "read"}})
    if not result.modified_count:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"success": True, "notification_id": notification_id}

@app.post("/notifications/read-all")
async def mark_all_notifications_read():
    result = await db["notifications"].update_many({"status": "unread"}, {"$set": {"status": "read"}})
    return {"success": True, "modified_count": result.modified_count}

@app.websocket("/notifications/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_connections.append(websocket)
    try:
        while True:
            try:
                data = await websocket.receive_text()
                # Optional: respond to client ping
                if data.lower() == "ping":
                    await websocket.send_text("pong")
            except WebSocketDisconnect:
                break
            except Exception:
                # Keep alive on other receive errors
                continue
    finally:
        if websocket in active_connections:
            active_connections.remove(websocket)


async def get_user_with_permissions(session_id: str):
    session_data = await get_session(sessions_collection, session_id)
    if not session_data:
        raise HTTPException(status_code=401, detail="Invalid session")

    user_doc = await collection.find_one({"email": session_data["email"]})
    if not user_doc:
        raise HTTPException(status_code=401, detail="User not found")

    # Ensure permissions is always a dict
    permissions = None if user_doc["role"] == "superadmin" else (user_doc.get("permissions") or DEFAULT_ADMIN_PERMISSIONS.copy())
    return user_doc, permissions


# Fetch logged-in user info
@app.get("/auth/me")
async def get_logged_in_user(request: Request):
    # Get session_id from cookie
    session_id = request.cookies.get("session_id")
    if not session_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # Fetch session from DB
    session_doc = await sessions_collection.find_one({"session_id": session_id})
    if not session_doc:
        raise HTTPException(status_code=401, detail="Invalid session or expired")

    # Fetch corresponding user from users collection
    user_doc = await collection.find_one({"email": session_doc["data"]["email"]})
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")

    # Prepare response
    permissions = None if user_doc["role"] == "superadmin" else user_doc.get("permissions", DEFAULT_ADMIN_PERMISSIONS.copy())
    return {
        "email": user_doc["email"],
        "name": user_doc.get("name", ""),
        "picture": user_doc.get("picture", ""),
        "role": user_doc.get("role", ""),
        "permissions": permissions
    }


# ===================================
# Health + Index setup
# ===================================
@app.get("/healthz")
async def health_check():
    return {"message": "Attendify backend active", "status": "OK"}

@app.on_event("startup")
async def setup_indexes():
    await db["attendance"].create_index([("emp_no", 1), ("month", 1)], unique=True)
    await db["employees"].create_index("emp_no", unique=True)
    await db["shifts"].create_index([("emp_no", 1), ("month", 1)])
    await sessions_collection.create_index("expiry", expireAfterSeconds=0)
    logger.info("Database indexes created.")


# Home Route
@app.get("/")
async def home():
    today = datetime.now(kolkata_tz)
    month = today.strftime("%Y-%m")
    year, month_num = today.year, today.month

    # Sundays
    cal = calendar.Calendar()
    sundays = [
        datetime(year, month_num, day, tzinfo=kolkata_tz).strftime("%d-%m-%Y")
        for week in cal.monthdayscalendar(year, month_num)
        for i, day in enumerate(week)
        if day != 0 and i == 6
    ]

    # Holidays from DB
    start_date = datetime(year, month_num, 1).strftime("%Y-%m-%d")
    end_day = calendar.monthrange(year, month_num)[1]
    end_date = datetime(year, month_num, end_day).strftime("%Y-%m-%d")

    holidays_cursor = db["holidays"].find({
        "date": {"$gte": start_date, "$lte": end_date}
    })

    holidays = []
    async for doc in holidays_cursor:
        holidays.append({
            "date": datetime.strptime(doc["date"], "%Y-%m-%d").strftime("%d-%m-%Y"),
            "name": doc["name"]
        })

    # Attendance snapshot logic
    yesterday = today.date() - timedelta(days=1)
    past_7_days = [today.date() - timedelta(days=i) for i in range(1, 8)]
    attendance_collection = db["attendance"]

    daily_summary = {
        "date": yesterday.strftime("%d-%m-%Y"),
        "present_count": 0,
        "total_marked": 0,
        "breakdown": {}
    }

    weekly_summary = defaultdict(int)
    total_days_counted = 0

    for date in past_7_days:
        date_str = date.strftime("%d-%m-%Y")
        cursor = attendance_collection.find({f"records.{date_str}": {"$exists": True}})
        day_present = 0
        total = 0
        temp_breakdown = defaultdict(int)

        async for doc in cursor:
            total += 1
            status = doc["records"].get(date_str, "")
            code = status.split("/")[0] if "/" in status else status
            temp_breakdown[code] += 1
            if code == "P":
                day_present += 1

        if total:
            total_days_counted += 1
            weekly_summary["present"] += day_present
            weekly_summary["total"] += total
            for k, v in temp_breakdown.items():
                weekly_summary[k] += v

        if date == yesterday:
            daily_summary["present_count"] = day_present
            daily_summary["total_marked"] = total
            daily_summary["breakdown"] = dict(temp_breakdown)

    weekly_avg_present = (
        weekly_summary["present"] / total_days_counted if total_days_counted else 0
    )
    weekly_avg_total = (
        weekly_summary["total"] / total_days_counted if total_days_counted else 0
    )

    return {
        "today": today.strftime("%d-%m-%Y %H:%M:%S %Z"),
        "month": month,
        "sundays": sundays,
        "holidays": holidays,
        "attendance_snapshot": {
            "yesterday": daily_summary,
            "weekly_avg": {
                "avg_present": round(weekly_avg_present, 2),
                "avg_total_marked": round(weekly_avg_total, 2),
                "days_counted": total_days_counted,
                "breakdown": {k: weekly_summary[k] for k in weekly_summary if k not in ["present", "total"]}
            }
        },
        "note": "This is a public dashboard. No login required."
    }


# ===================================
# AUTH — Google OAuth + Sessions
# ===================================
@app.get("/auth/google")
async def login_with_google():
    """Redirect user to Google OAuth"""
    google_auth_url = (
        "https://accounts.google.com/o/oauth2/v2/auth"
        f"?client_id={GOOGLE_CLIENT_ID}"
        "&response_type=code"
        f"&redirect_uri={REDIRECT_URI}"
        "&scope=openid%20email%20profile"
        "&access_type=offline"
        "&prompt=consent"
    )
    return RedirectResponse(url=google_auth_url)

@app.get("/auth/google/callback")
async def google_callback(request: Request):
    """Handle Google OAuth callback: exchange code for token, fetch user, create session."""
    code = request.query_params.get("code")
    error = request.query_params.get("error")

    # --- Error handling ---
    if error:
        if error == "access_denied":
            raise HTTPException(status_code=400, detail="User denied access")
        raise HTTPException(status_code=400, detail=f"OAuth error: {error}")
    if not code:
        raise HTTPException(status_code=400, detail="Missing authorization code")

    # --- Exchange authorization code for tokens ---
    token_url = "https://oauth2.googleapis.com/token"
    token_data = {
        "code": code,
        "client_id": GOOGLE_CLIENT_ID,
        "client_secret": GOOGLE_CLIENT_SECRET,
        "redirect_uri": REDIRECT_URI,
        "grant_type": "authorization_code",
    }

    try:
        async with httpx.AsyncClient() as client_http:
            token_response = await client_http.post(token_url, data=token_data)
            token_response.raise_for_status()
            token_json = token_response.json()
    except httpx.HTTPError as e:
        logger.error(f"[OAUTH] Token exchange failed: {e}")
        raise HTTPException(status_code=500, detail="Google authentication failed")

    access_token = token_json.get("access_token")
    if not access_token:
        raise HTTPException(status_code=500, detail="No access token received")

    # --- Get user info from Google ---
    try:
        async with httpx.AsyncClient() as client_http:
            userinfo_response = await client_http.get(
                "https://www.googleapis.com/oauth2/v2/userinfo",
                headers={"Authorization": f"Bearer {access_token}"}
            )
            userinfo_response.raise_for_status()
            user_info = userinfo_response.json()
    except httpx.HTTPError as e:
        logger.error(f"[OAUTH] Userinfo fetch failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch user info")

    user_email = user_info["email"]
    role = "superadmin" if user_email in SUPERADMINS else "admin"

    user_data = {
        "email": user_email,
        "is_verified": user_info.get("verified_email", False),
        "name": user_info.get("name", ""),
        "picture": user_info.get("picture", ""),
        "role": role,
        "updated_at": datetime.now(kolkata_tz),
        "permissions": DEFAULT_ADMIN_PERMISSIONS.copy() if role == "admin" else None,
    }

    # --- Upsert user record in MongoDB ---
    try:
        await collection.update_one(
            {"email": user_email},
            {"$set": user_data, "$setOnInsert": {"created_at": datetime.now(kolkata_tz)}},
            upsert=True
        )
        logger.info(f"[USER] Logged in: {user_email} ({role})")
    except Exception as e:
        logger.error(f"[MongoDB] User save failed: {e}")
        raise HTTPException(status_code=500, detail="User database update failed")

    # --- Create or reuse session ---
    try:
        device_info = request.headers.get("user-agent", "unknown")
        session_id = await create_session(sessions_collection, user_email, device_info, user_data)
    except Exception as e:
        logger.error(f"[SESSION] Creation failed: {e}")
        raise HTTPException(status_code=500, detail="Session creation failed")

    # --- Redirect to frontend with session cookie ---
    if not FRONTEND_URL:
        raise HTTPException(status_code=500, detail="FRONTEND_URL not configured")

    response = RedirectResponse(url=FRONTEND_URL)
    response.set_cookie(
        key="session_id",
        value=session_id,
        httponly=True,       # cannot be accessed by JS
        secure=True,         # HTTPS only (set False if testing locally)
        samesite="lax",      # adjust to 'none' if cross-site with HTTPS
        max_age=7*24*3600    # 1 week
    )

    logger.info(f"[LOGIN] Redirecting {user_email} to frontend")
    return response


@app.post("/logout")
async def logout(request: Request, response: Response):
    """Delete session and logout."""
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=400, detail="Missing Authorization header")

    session_id = auth_header.split(" ")[1]
    await delete_session(sessions_collection, session_id)
    response.delete_cookie("session_id")
    return {"message": "Logged out successfully"}

# ===================================
# EMPLOYEES CRUD
# ===================================
@app.post("/employees")
async def add_employee(request: Request, data: dict):
    user = await verify_session(request, sessions_collection)

    is_superadmin = user["role"] == "superadmin"
    
    if not user:
        raise HTTPException(status_code=401, detail="Invalid session")

    permissions = user.get("permissions") or DEFAULT_ADMIN_PERMISSIONS.copy()

    can_add_emp = permissions.get("can_add_employee", False)

    if not (is_superadmin or can_add_emp):
        await auto_notify(request, user["email"], "attempted to add employee")
        raise HTTPException(status_code=403, detail="Not authorized to add employees")

    required_fields = ["emp_no", "name", "designation", "type"]
    if not all(k in data for k in required_fields):
        raise HTTPException(status_code=400, detail=f"Missing fields: {required_fields}")

    # Clean emp_no
    data["emp_no"] = str(data["emp_no"]).split(".")[0]

    try:
        await db["employees"].insert_one(data)

    except DuplicateKeyError:
        raise HTTPException(
            status_code=409,
            detail=f"Employee with emp_no {data['emp_no']} already exists"
        )

    return {"message": f"Employee {data['name']} added successfully"}


@app.post("/upload/employees")
async def upload_employees(request: Request, file: UploadFile = File(...)):
    """
    Upload employee Excel file (regular + apprentice attendance sheets) and merge into DB.
    Only superadmin can perform this action.
    """
    # --- Superadmin check ---
    user = await verify_session(request, sessions_collection)
    if user["role"] != "superadmin":
        await auto_notify(request, user["email"], "attempted to upload employees")
        raise HTTPException(status_code=403, detail="Only superadmin can upload employees")

    # --- Load Excel ---
    try:
        df_excel = pd.ExcelFile(file.file)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error reading Excel file: {e}")

    # --- Attendance sheets to process ---
    regular_sheets = [
        "ATTENDANCE_SSEE_SW_KGP_I",
        "ATTENDANCE_SSEE_SW_KGP_II",
        "ATTENDANCE_SSEE_SW_KGP_III"
    ]
    apprentice_sheet = "APPRENTICE ATTENDANCE"

    all_employees = []

    # --- Process regular attendance sheets only ---
    for sheet in regular_sheets:
        if sheet not in df_excel.sheet_names:
            continue
        try:
            df = df_excel.parse(sheet_name=sheet, skiprows=6)
            df.rename(columns={
                "S. NO.": "S_No",
                "NAME": "Name",
                "DESIGNATION": "Designation",
                "EMPLOYEE NO.": "Employee_No"
            }, inplace=True)
            df = df.dropna(subset=["Employee_No"])

            for _, row in df.iterrows():
                all_employees.append({
                    "emp_no": str(row["Employee_No"]).strip().split(".")[0].replace(" ", ""),
                    "name": str(row["Name"]).strip(),
                    "designation": str(row["Designation"]).strip(),
                    "type": "regular"
                })
        except Exception as e:
            logger.warning(f"Error reading regular sheet {sheet}: {e}")
            continue

    # --- Process apprentice attendance sheet only ---
    if apprentice_sheet in df_excel.sheet_names:
        try:
            df = df_excel.parse(sheet_name=apprentice_sheet, skiprows=8)
            df.rename(columns={
                "S. NO.": "S_No",
                "NAME": "Name",
                "DESIGNATION": "Designation",
                "EMPLOYEE NO.": "Employee_No"
            }, inplace=True)
            df = df.dropna(subset=["Employee_No"])

            for _, row in df.iterrows():
                all_employees.append({
                    "emp_no": str(row["Employee_No"]).strip().split(".")[0].replace(" ", ""),
                    "name": str(row["Name"]).strip(),
                    "designation": str(row["Designation"]).strip(),
                    "type": "apprentice"
                })
        except Exception as e:
            logger.warning(f"Error reading apprentice sheet: {e}")

    if not all_employees:
        raise HTTPException(status_code=400, detail="No employee data found in the attendance sheets.")

    # --- Insert / Update DB ---
    emp_collection = db["employees"]
    added, updated, unchanged = 0, 0, 0

    for emp in all_employees:
        existing = await emp_collection.find_one({"emp_no": emp["emp_no"]})
        if existing:
            if existing != emp:
                await emp_collection.update_one({"emp_no": emp["emp_no"]}, {"$set": emp})
                updated += 1
            else:
                unchanged += 1
        else:
            await emp_collection.insert_one(emp)
            added += 1

    return {
        "message": "Employee attendance upload completed.",
        "summary": {
            "added": added,
            "updated": updated,
            "unchanged": unchanged,
            "skipped": 0
        },
        "total_processed": len(all_employees)
    }


@app.delete("/employees/{emp_no}")
async def delete_employee(emp_no: str, request: Request):
    user = await verify_session(request, sessions_collection)
    if user["role"] != "superadmin":
        await auto_notify(request, user["email"], f"delete employee {emp_no}")
        raise HTTPException(status_code=403, detail="Not authorized to delete employees")

    result = await db["employees"].delete_one({"emp_no": emp_no})
    if not result.deleted_count:
        raise HTTPException(status_code=404, detail="Employee not found")

    return {"message": f"Employee {emp_no} deleted successfully"}

@app.get("/employees")
async def get_employees():
    emps = await db["employees"].find().sort("emp_no", 1).to_list(200)
    for e in emps:
        e["_id"] = str(e["_id"])
    return {"employees": emps, "count": len(emps)}


@app.get("/employees/count")
async def get_employee_count(request: Request, response: Response):
    await verify_session(request, response)
    count = await db.employees.count_documents({})
    return {"count": count}

# ===================================
# HOLIDAYS
# ===================================
@app.post("/holidays")
async def add_holiday(request: Request, data: dict):
    user = await verify_session(request, sessions_collection)

    if user["role"] != "superadmin":
        await auto_notify(request, user["email"], "add holiday")
        raise HTTPException(status_code=403, detail="Not authorized to add holidays")

    if "date" not in data or "name" not in data:
        raise HTTPException(status_code=400, detail="Fields 'date' and 'name' required")

    # Validate date
    try:
        date_obj = pd.to_datetime(data["date"], dayfirst=True, errors="raise")
    except:
        raise HTTPException(status_code=400, detail="Invalid date format")

    holiday_doc = {
        "name": data["name"],
        "date": date_obj.strftime("%Y-%m-%d"),
        "day": date_obj.strftime("%A"),
        "year": date_obj.year,
        "created_at": datetime.now(kolkata_tz),
        "created_by": user["email"],
    }

    result = await db["holidays"].insert_one(holiday_doc)

    # MongoDB added ObjectId to holiday_doc → clean it
    clean_doc = dict(holiday_doc)
    clean_doc["_id"] = str(result.inserted_id)

    return {
        "message": f"Holiday '{clean_doc['name']}' added for {clean_doc['date']}",
        "holiday": clean_doc
    }


@app.get("/holidays")
async def list_holidays():
    holidays = await db["holidays"].find().sort("date", 1).to_list(100)

    for h in holidays:
        h["_id"] = str(h["_id"])

    return {"holidays": holidays, "count": len(holidays)}


@app.post("/upload/holidays")
async def upload_holidays(request: Request, file: UploadFile = File(...)):
    user = await verify_session(request, sessions_collection)
    created_by = user.get("email")
    # Save uploaded file to temp
    try:
        suffix = Path(file.filename).suffix or ".xlsx"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            temp_path = tmp.name
            tmp.write(await file.read())
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save uploaded file: {e}")

    try:
        # Debug: show filename (useful to confirm correct file from client)
        logger.info(f"[HOLIDAYS UPLOAD] Uploaded filename: {file.filename}")

        # Open workbook and auto-detect sheet containing "holiday"
        try:
            with pd.ExcelFile(temp_path) as xl:
                sheets = xl.sheet_names
                logger.info(f"[HOLIDAYS UPLOAD] Sheets found: {sheets}")

                # Build normalized map: normalized_name -> actual_name
                normalized = {s.strip().lower(): s for s in sheets}

                # Prefer exact "holidays" or any sheet that contains "holiday"
                sheet = None
                if "holidays" in normalized:
                    sheet = normalized["holidays"]
                else:
                    for sname in sheets:
                        if "holiday" in sname.lower():
                            sheet = sname
                            break

                if not sheet:
                    raise HTTPException(
                        status_code=400,
                        detail=f"No HOLIDAYS sheet found. Sheets detected: {sheets}"
                    )

                # Parse with header row at index 1
                df = xl.parse(sheet_name=sheet, header=1)
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Error reading Excel file: {e}")

        # Normalize column names
        df.columns = [str(c).strip() for c in df.columns]

        # Validate required columns
        required = {"Name of the Occasion", "Date"}
        missing = required - set(df.columns)
        if missing:
            raise HTTPException(
                status_code=400,
                detail=f"Missing required columns: {sorted(list(missing))}. Found columns: {list(df.columns)}"
            )

        # Drop rows missing essential data
        df_filtered = df.dropna(subset=["Name of the Occasion", "Date"])

        holidays = []
        for _, r in df_filtered.iterrows():
            name = str(r["Name of the Occasion"]).strip()
            date_raw = str(r["Date"]).strip()
            # parse with dayfirst; coerce invalid -> NaT
            date_obj = pd.to_datetime(date_raw, dayfirst=True, errors="coerce")
            if pd.isna(date_obj):
                logger.warning(f"[HOLIDAYS UPLOAD] Skipping invalid date: {date_raw} for '{name}'")
                continue

            holidays.append({
                "name": name,
                "date": date_obj.strftime("%Y-%m-%d"),
                "day": r.get("Day", ""),
                "year": int(r.get("Year", date_obj.year)),
                "created_at": datetime.now(kolkata_tz),
                "created_by": created_by
            })

        if not holidays:
            raise HTTPException(status_code=400, detail="No valid holiday rows found after parsing.")

        # Save to DB
        hol_collection = db["holidays"]
        await hol_collection.delete_many({})
        await hol_collection.insert_many(holidays)

        # Clean sample so it contains no ObjectId
        clean_sample = []
        for h in holidays[:5]:
            h2 = dict(h)
            h2.pop("_id", None)   # remove ObjectId
            clean_sample.append(h2)

        return {
            "message": f"{len(holidays)} holidays uploaded successfully.",
            "sample": clean_sample
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("[HOLIDAYS UPLOAD] Unexpected error")
        raise HTTPException(status_code=500, detail=f"Error parsing holidays: {e}")
    finally:
        # Cleanup temp file
        try:
            os.remove(temp_path)
        except PermissionError:
            # brief pause then retry
            time.sleep(0.2)
            try:
                os.remove(temp_path)
            except Exception:
                logger.warning(f"Could not delete temp file {temp_path} after retry.")
        except Exception:
            logger.warning(f"Could not delete temp file {temp_path}.")


# ===================================
# SHIFTS
# ===================================
@app.post("/shift")
async def assign_shift(request: Request, data: dict):
    user = await verify_session(request, sessions_collection)

    emp_no = data.get("emp_no")
    name_query = data.get("name")
    shift = data.get("shift")
    date = data.get("date")

    if not shift or not date:
        raise HTTPException(status_code=400, detail="shift and date required")

    # ----- Step 1: Fetch employee -----
    emp = None

    if emp_no:
        clean_no = str(emp_no).split(".")[0]
        emp = await db["employees"].find_one({"emp_no": clean_no})
        if not emp:
            raise HTTPException(status_code=404, detail=f"Employee not found for emp_no {clean_no}")

    elif name_query:
        cursor = db["employees"].find({
            "name": {"$regex": name_query, "$options": "i"}
        })
        matches = await cursor.to_list(length=20)

        if not matches:
            raise HTTPException(status_code=404, detail=f"No employees found matching '{name_query}'")

        if len(matches) > 1:
            return JSONResponse(
                status_code=409,
                content={
                    "detail": "Multiple employees match this name",
                    "matches": [
                        {
                            "emp_no": m["emp_no"],
                            "name": m["name"],
                            "designation": m.get("designation", "")
                        }
                        for m in matches
                    ]
                }
            )

        emp = matches[0]
    else:
        raise HTTPException(status_code=400, detail="Provide emp_no or name")

    cleaned_emp_no = str(emp["emp_no"]).split(".")[0]

    # ----- Step 2: Check existing shift -----
    existing_shift = await db["shifts"].find_one(
        {"emp_no": cleaned_emp_no, "date": date}
    )

    # ❌ Admin cannot edit, only add
    if user["role"] == "admin":
        if not user.get("permissions", {}).get("can_add_shift", False):
            await auto_notify(request, user["email"], "add shift")
            raise HTTPException(status_code=403, detail="Permission denied")

        if existing_shift:
            await auto_notify(request, user["email"], "edit shift")
            raise HTTPException(status_code=403, detail="Admins cannot edit shift")

    # ----- Step 3: Upsert shift -----
    doc = {
        "emp_no": cleaned_emp_no,
        "name": emp["name"],
        "designation": emp.get("designation", ""),
        "shift": shift,
        "date": date,
        "updated_at": datetime.now(kolkata_tz),
        "updated_by": user["email"],
    }

    await db["shifts"].update_one(
        {"emp_no": cleaned_emp_no, "date": date},
        {"$set": doc},
        upsert=True
    )

    return {
        "message": f"Shift {shift} assigned to {emp['name']} ({cleaned_emp_no}) on {date}",
        "updated": existing_shift is not None,
        "added": existing_shift is None,
        "shift_record": doc
    }


# ===================================
# ATTENDANCE
# ===================================
@app.post("/attendance")
async def add_attendance(request: Request, data: dict):
    user = await verify_session(request, sessions_collection)

    # --- Role validation ---
    if user["role"] not in ["superadmin", "admin"]:
        raise HTTPException(status_code=403, detail="Not authorized")

    # --- Admin permission: can ADD but never EDIT ---
    if user["role"] == "admin":
        if not user.get("permissions", {}).get("can_add_attendance", False):
            await auto_notify(request, user["email"], "add attendance")
            raise HTTPException(status_code=403, detail="Permission denied")

    # --- Required fields ---
    required = ["emp_no", "date", "code"]
    if not all(k in data for k in required):
        raise HTTPException(status_code=400, detail=f"Fields required: {required}")

    emp_no_clean = str(data["emp_no"]).split(".")[0]
    emp = await db["employees"].find_one({"emp_no": emp_no_clean})
    if not emp:
        raise HTTPException(status_code=404, detail=f"Employee {data['emp_no']} not found")

    # --- Date formatting ---
    date_obj = datetime.strptime(data["date"], "%Y-%m-%d")
    month_str = date_obj.strftime("%Y-%m")
    date_key = date_obj.strftime("%d-%m-%Y")

    # --- Fetch existing record ---
    existing = await db["attendance"].find_one(
        {"emp_no": emp["emp_no"], "month": month_str}
    )

    # Admin cannot edit existing dates
    if user["role"] == "admin" and existing and date_key in existing.get("attendance", {}):
        await auto_notify(request, user["email"], "edit attendance")
        raise HTTPException(status_code=403, detail="Admins cannot edit attendance")

    # --- Build sorted attendance dictionary ---
    attendance_map = existing.get("attendance", {}) if existing else {}
    attendance_map[date_key] = data["code"]

    # Sort dates
    sorted_attendance = dict(sorted(
        attendance_map.items(),
        key=lambda x: datetime.strptime(x[0], "%d-%m-%Y")
    ))

    # --- Save to DB ---
    await db["attendance"].update_one(
        {"emp_no": emp["emp_no"], "month": month_str},
        {"$set": {
            "attendance": sorted_attendance,
            "emp_name": emp["name"],
            "type": emp["type"],
            "updated_by": user["email"]
        }},
        upsert=True
    )

    return {
        "message": f"Attendance added for {emp['emp_no']} - {emp['name']} on {data['date']}",
        "updated": existing is not None,
        "added": existing is None
    }


# ===================================
# EXPORT ATTENDANCE EXCEL
# ===================================
@app.get("/attendance/legend")
async def get_attendance_legend():
    return {
        "regular": REGULAR_LEGEND,
        "apprentice": APPRENTICE_LEGEND,
        "message": "Attendance code legends"
    }

@app.get("/export_regular")
async def export_regular(month: str = "2025-07", request: Request = None, response: Response = None):
    user = await verify_session(request, sessions_collection)
    stream = await create_attendance_excel(db, "regular", month)
    return StreamingResponse(
        stream,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=regular_attendance_{month}.xlsx"}
    )

@app.get("/export_apprentice")
async def export_apprentice(month: str = "2025-07", request: Request = None, response: Response = None):
    user = await verify_session(request, sessions_collection)
    stream = await create_attendance_excel(db, "apprentice", month)
    return StreamingResponse(
        stream,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=apprentice_attendance_{month}.xlsx"}
    )


# ===================================
# PERMISSIONS MANAGEMENT
# ===================================
def get_permissions(user_doc: dict) -> dict:
    if user_doc["role"] == "superadmin":
        return None
    return user_doc.get("permissions") or DEFAULT_ADMIN_PERMISSIONS.copy()

def has_permission(user_doc: dict, key: str) -> bool:
    if user_doc.get("role") == "superadmin":
        return True

    perms = get_permissions(user_doc)
    return perms.get(key, False)

def update_permissions(user_doc: dict, updates: dict):
    if user_doc.get("role") == "superadmin":
        raise ValueError("Cannot update permissions for superadmin")

    perms = get_permissions(user_doc)
    for k, v in updates.items():
        if k in DEFAULT_ADMIN_PERMISSIONS:
            perms[k] = bool(v)

    user_doc["permissions"] = perms
    return user_doc


@app.get("/permissions/{admin_email}")
async def get_admin_permissions(admin_email: str, request: Request):
    user = await verify_session(request, sessions_collection)
    if user["role"] != "superadmin":
        await auto_notify(request, user["email"], f"attempted to view permissions of {admin_email}")
        raise HTTPException(status_code=403, detail="Not authorized")

    admin_doc = await collection.find_one({"email": admin_email})
    if not admin_doc:
        raise HTTPException(status_code=404, detail="User not found")

    # Superadmin → ignore permissions field
    if admin_doc["role"] == "superadmin":
        return {
            "email": admin_doc["email"],
            "name": admin_doc.get("name", ""),
            "role": "superadmin",
            "permissions": "ALL"
        }

    return {
        "email": admin_email,
        "permissions": get_permissions(admin_doc)
    }


@app.post("/permissions/{admin_email}")
async def update_admin_permissions(admin_email: str, request: Request, data: dict):
    user = await verify_session(request, sessions_collection)
    if user["role"] != "superadmin":
        await auto_notify(request, user["email"], f"attempted to edit permissions of {admin_email}")
        raise HTTPException(status_code=403, detail="Not authorized")

    target = await collection.find_one({"email": admin_email})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    if target["role"] == "superadmin":
        raise HTTPException(status_code=400, detail="Cannot modify superadmin permissions")

    perms = get_permissions(target)

    for k, v in data.items():
        if k in DEFAULT_ADMIN_PERMISSIONS:
            perms[k] = bool(v)

    await collection.update_one(
        {"email": admin_email},
        {"$set": {"permissions": perms}}
    )

    return {"message": f"Permissions updated for {admin_email}", "updated_permissions": perms}


@app.get("/permissions")
async def list_admins_permissions(request: Request):
    user = await verify_session(request, sessions_collection)

    if user["role"] != "superadmin":
        await auto_notify(request, user["email"], "attempted to view all admins permissions")
        raise HTTPException(status_code=403, detail="Not authorized")

    # Fetch ONLY admins
    cursor = collection.find({"role": "admin"})
    admins = []

    async for admin in cursor:
        perms = admin.get("permissions") or DEFAULT_ADMIN_PERMISSIONS.copy()

        admins.append({
            "email": admin["email"],
            "name": admin.get("name", ""),
            "role": "admin",
            "permissions": perms
        })

    return {"admins": admins, "count": len(admins)}
