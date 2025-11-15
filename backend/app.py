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
from sessions import create_session, get_session, delete_session, verify_session, cleanup_expired_sessions
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
async def google_callback(request: Request, response: Response):
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

    # --- Set secure cookie ---
    response.set_cookie(
        key="session_id",
        value=session_id,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=7 * 24 * 3600,  # 7 days
    )

    # --- Redirect to frontend with session info ---
    if not FRONTEND_URL:
        raise HTTPException(status_code=500, detail="FRONTEND_URL not configured")

    params = {
        "session_id": session_id,
        "email": user_email,
        "name": user_info.get("name", ""),
        "picture": user_info.get("picture", ""),
        "role": role,
    }

    redirect_url = f"{FRONTEND_URL}/?{urlencode(params)}"
    logger.info(f"[LOGIN] Redirecting {user_email} to frontend")

    return RedirectResponse(url=redirect_url)

@app.post("/logout")
async def logout(request: Request):
    """Delete session and logout."""
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=400, detail="Missing Authorization header")

    session_id = auth_header.split(" ")[1]
    await delete_session(sessions_collection, session_id)
    return {"message": "Logged out successfully"}

# ===================================
# EMPLOYEES CRUD
# ===================================
@app.post("/employees")
async def add_employee(request: Request, data: dict):
    user = await verify_session(request, sessions_collection)

    is_superadmin = user["role"] == "superadmin"
    can_add_emp = user.get("permissions", {}).get("can_add_employee", False)

    if not (is_superadmin or can_add_emp):
        await auto_notify(request, user["email"], "attempted to add employee")
        raise HTTPException(status_code=403, detail="Not authorized to add employees")

    required_fields = ["emp_no", "name", "designation", "type"]
    if not all(k in data for k in required_fields):
        raise HTTPException(status_code=400, detail=f"Missing fields: {required_fields}")

    emp_no = str(data["emp_no"]).split(".")[0].strip()
    
    existing = await db["employees"].find_one({"emp_no": emp_no})
    if existing:
        if not is_superadmin:
            # Admin cannot edit existing employees
            await auto_notify(request, user["email"], f"attempted to edit employee {emp_no}")
            raise HTTPException(status_code=403, detail="Admins cannot edit existing employees")
        else:
            await db["employees"].update_one({"emp_no": emp_no}, {"$set": data})
            return {"message": f"Employee {emp_no} updated successfully"}

    # Insert new employee
    await db["employees"].insert_one(data)
    
    # Notify superadmins if added by admin
    if not is_superadmin:
        await auto_notify(request, user["email"], f"added employee {emp_no}")

    try:
        await db["employees"].insert_one(data)

    except DuplicateKeyError:
        raise HTTPException(
            status_code=409,
            detail=f"Employee with emp_no {data['emp_no']} already exists"
        )

    return {"message": f"Employee {data['name']} added successfully"}


@app.post("/employees/manual")
async def bulk_add_employees(request: Request, file: UploadFile = File(...)):
    user = await verify_session(request, sessions_collection)
    if user["role"] != "superadmin":
        await auto_notify(request, user["email"], "bulk upload employees")
        raise HTTPException(status_code=403, detail="Only superadmin can upload employees")

    df = pd.read_excel(file.file)
    records = df.to_dict(orient="records")
    await db["employees"].insert_many(records)
    return {"message": f"{len(records)} employees uploaded successfully"}

@app.post("/upload/employees")
async def load_employees_safe():
    EMPLOYEE_SHEET = "ATTENDANCE SHEET MUSTER ROLL OF SSEE SW KGP.xlsx"
    regular_sheets = [
        "ATTENDANCE_SSEE_SW_KGP_I", 
        "ATTENDANCE_SSEE_SW_KGP_II", 
        "ATTENDANCE_SSEE_SW_KGP_III"
    ]
    apprentice_sheet = "APPRENTICE ATTENDANCE"

    all_employees = []

    # Process regular employees
    for sheet in regular_sheets:
        try:
            df = pd.read_excel(EMPLOYEE_SHEET, sheet_name=sheet, skiprows=6)
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
            print(f"Error reading sheet {sheet}: {e}")
            continue

    # Process apprentice employees
    try:
        df = pd.read_excel(EMPLOYEE_SHEET, sheet_name=apprentice_sheet, skiprows=8)
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
        print(f"Error reading apprentice sheet: {e}")

    if not all_employees:
        raise HTTPException(status_code=400, detail="No employee data found.")

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
        "message": "Employee upload completed.",
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
    is_superadmin = user["role"] == "superadmin"
    can_add_shift = user.get("permissions", {}).get("can_add_shift", False)

    if not (is_superadmin or can_add_shift):
        await auto_notify(request, user["email"], "attempted to assign shift")
        raise HTTPException(status_code=403, detail="Not authorized")

    # Fetch employee (emp_no or name)
    emp_no = data.get("emp_no")
    date = data.get("date")
    shift = data.get("shift")
    if not emp_no or not date or not shift:
        raise HTTPException(status_code=400, detail="emp_no, date, and shift required")

    existing = await db["shifts"].find_one({"emp_no": emp_no, "date": date})
    if existing and not is_superadmin:
        await auto_notify(request, user["email"], f"attempted to edit shift for {emp_no} on {date}")
        raise HTTPException(status_code=403, detail="Admins cannot edit existing shifts")

    doc = {
        "emp_no": emp_no,
        "shift": shift,
        "date": date,
        "updated_by": user["email"],
        "updated_at": datetime.now(kolkata_tz)
    }

    await db["shifts"].update_one({"emp_no": emp_no, "date": date}, {"$set": doc}, upsert=True)

    if not is_superadmin:
        await auto_notify(request, user["email"], f"added shift for {emp_no} on {date}")

    return {"message": f"Shift assigned to {emp_no} on {date}"}


# ===================================
# ATTENDANCE
# ===================================
@app.post("/attendance")
async def add_attendance(request: Request, data: dict):
    user = await verify_session(request, sessions_collection)
    is_superadmin = user["role"] == "superadmin"
    can_add_attendance = user.get("permissions", {}).get("can_add_attendance", False)

    if not (is_superadmin or can_add_attendance):
        await auto_notify(request, user["email"], "attempted to add attendance")
        raise HTTPException(status_code=403, detail="Not authorized")

    emp_no = str(data["emp_no"]).split(".")[0]
    date = data["date"]
    code = data["code"]

    existing = await db["attendance"].find_one({"emp_no": emp_no, f"attendance.{date}": {"$exists": True}})
    if existing and not is_superadmin:
        await auto_notify(request, user["email"], f"attempted to edit attendance for {emp_no} on {date}")
        raise HTTPException(status_code=403, detail="Admins cannot edit existing attendance")

    await db["attendance"].update_one(
        {"emp_no": emp_no},
        {"$set": {f"attendance.{date}": code, "updated_by": user["email"], "updated_at": datetime.now(kolkata_tz)}},
        upsert=True
    )

    if not is_superadmin:
        await auto_notify(request, user["email"], f"added attendance for {emp_no} on {date}")

    return {"message": f"Attendance marked for {emp_no} on {date}"}


@app.post("/upload/attendance")
async def upload_attendance_excel(request: Request, file: UploadFile = File(...)):
    user = await verify_session(request, sessions_collection)
    if user["role"] != "superadmin":
        await auto_notify(request, user["email"], "upload attendance Excel")
        raise HTTPException(status_code=403, detail="Only superadmin can upload attendance")

    try:
        df = pd.read_excel(file.file)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error reading Excel: {e}")

    # Detect date columns dynamically (e.g., 1–31)
    date_cols = [col for col in df.columns if str(col).strip().isdigit()]
    base_cols = ["Emp No", "Name", "Designation", "Type"]

    if not all(c in df.columns for c in base_cols):
        raise HTTPException(status_code=400, detail=f"Excel missing base columns: {base_cols}")
    if not date_cols:
        raise HTTPException(status_code=400, detail="No day columns (1–31) found in Excel.")

    inserted = 0
    for _, row in df.iterrows():
        emp_no = str(row["Emp No"]).strip()
        if not emp_no:
            continue

        # Fetch employee from DB
        emp = await db["employees"].find_one({"emp_no": emp_no})
        if not emp:
            continue  # skip if employee not found

        emp_name = emp["name"]
        emp_type = emp["type"]

        # Determine month for attendance record
        today = datetime.now(kolkata_tz)
        if emp_type == "regular":
            start_day = 11
            start_month = today.month - 1 if today.month > 1 else 12
            start_year = today.year if today.month > 1 else today.year - 1
            month_str = f"{start_year}-{start_month:02d}"
        else:
            month_str = today.strftime("%Y-%m")

        attendance = {}
        for col in date_cols:
            val = str(row[col]).strip() if not pd.isna(row[col]) else ""
            if val:
                try:
                    day = int(col)
                    if emp_type == "regular":
                        date_obj = datetime(start_year, start_month, start_day, tzinfo=kolkata_tz) + timedelta(days=(day-1))
                    else:
                        date_obj = datetime(today.year, today.month, day, tzinfo=kolkata_tz)
                    attendance[date_obj.strftime("%d-%m-%Y")] = val
                except Exception:
                    continue

        if not attendance:
            continue

        await db["attendance"].update_one(
            {"emp_no": emp_no, "month": month_str},
            {"$set": {
                "emp_name": emp_name,
                "type": emp_type,
                "attendance": attendance,
                "updated_by": user["email"],
                "uploaded_at": datetime.now(kolkata_tz)
            }},
            upsert=True
        )
        inserted += 1

    return {"message": f"Attendance uploaded successfully for {inserted} employees."}

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

# Default permissions template for admins
DEFAULT_ADMIN_PERMISSIONS = {
    "can_add_employee": False,
    "can_edit_employee": False,
    "can_delete_employee": False,
    "can_add_shift": False,
    "can_edit_shift": False,
    "can_add_attendance": False,
    "can_edit_attendance": False,
    "can_upload_excel": False,
    "can_manage_holidays": False,
    "can_view_reports": False,
}


def get_permissions(user_doc: dict) -> dict:
    return user_doc.get("permissions", DEFAULT_ADMIN_PERMISSIONS.copy())

def has_permission(user_doc: dict, key: str) -> bool:
    return get_permissions(user_doc).get(key, False)

def update_permissions(user_doc: dict, updates: dict) -> dict:
    """
    Programmatically update permissions in-memory (no DB write).
    """
    if "permissions" not in user_doc:
        user_doc["permissions"] = DEFAULT_ADMIN_PERMISSIONS.copy()
    for k, v in updates.items():
        if k in DEFAULT_ADMIN_PERMISSIONS:
            user_doc["permissions"][k] = bool(v)
    return user_doc

@app.get("/permissions/{admin_email}")
async def get_admin_permissions(admin_email: str, request: Request):
    user = await verify_session(request, sessions_collection)
    if user["role"] != "superadmin":
        await auto_notify(request, user["email"], f"attempted to view permissions of {admin_email}")
        raise HTTPException(status_code=403, detail="Not authorized")

    admin_doc = await collection.find_one({"email": admin_email, "role": "admin"})
    if not admin_doc:
        raise HTTPException(status_code=404, detail="Admin not found")

    return {"email": admin_email, "permissions": get_permissions(admin_doc)}


@app.post("/permissions/{admin_email}")
async def update_admin_permissions(admin_email: str, request: Request, data: dict):
    user = await verify_session(request, sessions_collection)
    if user["role"] != "superadmin":
        await auto_notify(request, user["email"], f"attempted to edit permissions of {admin_email}")
        raise HTTPException(status_code=403, detail="Not authorized")

    admin_doc = await collection.find_one({"email": admin_email, "role": "admin"})
    if not admin_doc:
        raise HTTPException(status_code=404, detail="Admin not found")

    # Fetch existing permissions
    existing_permissions = admin_doc.get("permissions", DEFAULT_ADMIN_PERMISSIONS.copy())

    # Update only the keys provided
    for k, v in data.items():
        if k in DEFAULT_ADMIN_PERMISSIONS:
            existing_permissions[k] = bool(v)

    # Write back merged permissions
    await collection.update_one(
        {"email": admin_email},
        {"$set": {"permissions": existing_permissions}}
    )

    # Notify the admin
    notification = {
        "title": "Permissions Updated",
        "message": f"Your permissions have been updated by superadmin {user['email']}.",
        "timestamp": datetime.now(kolkata_tz).strftime("%d-%m-%Y %H:%M:%S"),
        "status": "unread",
        "expireAt": datetime.now(kolkata_tz) + timedelta(days=30)
    }
    await db["notifications"].insert_one(notification)

    return {"message": f"Permissions updated for {admin_email}", "updated_permissions": updates}


@app.get("/permissions")
async def list_admins_permissions(request: Request):
    user = await verify_session(request, sessions_collection)
    if user["role"] != "superadmin":
        await auto_notify(request, user["email"], "attempted to view all admins permissions")
        raise HTTPException(status_code=403, detail="Not authorized")

    cursor = collection.find({"role": "admin"})
    admins = []
    async for admin in cursor:
        admins.append({
            "email": admin["email"],
            "name": admin.get("name", ""),
            "permissions": get_permissions(admin)
        })

    return {"admins": admins, "count": len(admins)}
