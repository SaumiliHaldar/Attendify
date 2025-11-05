from fastapi import FastAPI, Request, HTTPException, APIRouter, WebSocket, WebSocketDisconnect, Depends
from fastapi.responses import RedirectResponse, JSONResponse, StreamingResponse
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
import os
import json
import httpx
import pytz
from datetime import datetime, timedelta
from typing import Dict, Optional
import calendar
from io import BytesIO
from excelmaker import create_attendance_excel
import pandas as pd
from fastapi import UploadFile, File, Header
from fastapi.middleware.cors import CORSMiddleware
from urllib.parse import urlencode
import secrets
import re
import html
import logging
from pydantic import BaseModel, Field, validator
from collections import defaultdict
import tempfile

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

app = FastAPI()

# MongoDB setup
MONGO_URI = os.getenv("MONGO_URI")
client = AsyncIOMotorClient(MONGO_URI, tls=True)
db = client["Attendify"]
collection = db["users"]

# Google Auth
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET")
REDIRECT_URI = os.getenv("REDIRECT_URI")
FRONTEND_URL = os.getenv("FRONTEND_URL")

# Security Config
SUPERADMIN_EMAILS = [email.strip() for email in os.getenv("SUPERADMIN_EMAILS", "").split(",") if email.strip()]
ALLOWED_ORIGINS = [origin.strip() for origin in os.getenv("ALLOWED_ORIGINS", "*").split(",") if origin.strip()]
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB
SESSION_TTL_SECONDS = 7 * 24 * 3600  # 7 days

# Timezone setup for Kolkata
kolkata_tz = pytz.timezone("Asia/Kolkata")

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)

# Security Headers Middleware
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Strict-Transport-Security"] = "max-age=31536000"
    return response

# ==============================
# CENTRALIZED SESSION MANAGEMENT (IN-MEMORY)
# ==============================

# Global in-memory dictionary for active sessions
# Key: session_token (str)
# Value: {"user_data": user_data_dict, "expires_at": datetime object}
active_sessions: Dict[str, Dict] = {}


async def verify_session_token(authorization: Optional[str] = Header(None)) -> dict:
    """
    CENTRALIZED session verification - uses in-memory store.
    - Validates token from Authorization header (Bearer <token>)
    - Checks in-memory store for session and expiration
    - Refreshes session TTL on valid access
    - Returns user data dict
    
    Raises HTTPException(403) if invalid/expired
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=403, detail="Bearer token required in Authorization header")
    
    token = authorization[7:].strip()
    
    if not token:
        raise HTTPException(status_code=403, detail="Empty authorization token")
    
    # Check in-memory store
    session_entry = active_sessions.get(token)
    
    if not session_entry:
        raise HTTPException(status_code=403, detail="Session expired or invalid. Please login again.")
    
    # Check expiration
    if datetime.now() > session_entry["expires_at"]:
        # Delete expired session
        del active_sessions[token]
        logger.info(f"Session expired and deleted for token: {token[:10]}...")
        raise HTTPException(status_code=403, detail="Session expired. Please login again.")
    
    # Session is valid: get user data
    user_data = session_entry["user_data"]
    
    # REFRESH SESSION TTL - extends session by 7 days on each valid access
    new_expiry = datetime.now() + timedelta(seconds=SESSION_TTL_SECONDS)
    session_entry["expires_at"] = new_expiry
    logger.info(f"Session refreshed for user: {user_data['email']}")
    
    return user_data


async def require_admin(user_data: dict = Depends(verify_session_token)) -> dict:
    """Dependency to require admin or superadmin role"""
    if user_data.get("role") not in ["admin", "superadmin"]:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user_data


async def require_superadmin(user_data: dict = Depends(verify_session_token)) -> dict:
    """Dependency to require superadmin role"""
    if user_data.get("role") != "superadmin":
        raise HTTPException(status_code=403, detail="Superadmin access required")
    return user_data

# ==============================
# Security Helper Functions
# ==============================

def escape_regex(text: str) -> str:
    """Escape regex special characters"""
    return re.escape(text)

def sanitize_input(text: str) -> str:
    """Sanitize user input to prevent XSS"""
    return html.escape(text.strip())

def clean_emp_no(emp_no):
    """Remove .0 from employee numbers and clean whitespace"""
    emp_str = str(emp_no).strip()
    if emp_str.endswith('.0'):
        emp_str = emp_str[:-2]
    return emp_str

# ==============================
# Pydantic Models for Validation
# ==============================

class EmployeeCreate(BaseModel):
    emp_no: str = Field(..., min_length=1, max_length=20)
    name: str = Field(..., min_length=1, max_length=100)
    designation: str = Field(..., min_length=1, max_length=100)
    type: str
    
    @validator('type')
    def validate_type(cls, v):
        if v.lower() not in ['regular', 'apprentice']:
            raise ValueError('Type must be regular or apprentice')
        return v.lower()
    
    @validator('name', 'designation')
    def sanitize_string(cls, v):
        return sanitize_input(v)

class AttendanceSubmit(BaseModel):
    emp_no: str = Field(..., min_length=1, max_length=20)
    month: str = Field(..., pattern=r'^\d{4}-\d{2}$')
    attendance: Dict[str, str]
    
    @validator('attendance')
    def validate_attendance(cls, v):
        if not v:
            raise ValueError('Attendance cannot be empty')
        # Validate date format
        for date_str in v.keys():
            try:
                datetime.strptime(date_str, "%d-%m-%Y")
            except:
                raise ValueError(f'Invalid date format: {date_str}')
        return v

class ShiftAssign(BaseModel):
    emp_no: str = Field(..., min_length=1, max_length=20)
    month: str = Field(..., pattern=r'^\d{4}-\d{2}$')
    shift: Dict

# ==============================
# Routes
# ==============================

@app.get("/healthz")
async def health_check():
    return {"message": "Attendify is active!", "status": "OK"}

# ==============================
# Notifications Section
# ==============================
active_connections: list[WebSocket] = []

async def notify_superadmins(message: dict):
    """Push a notification to all connected superadmin sockets."""
    for connection in active_connections:
        try:
            await connection.send_text(json.dumps(message))
        except:
            continue

async def auto_notify(request: Request, actor: str, action: str):
    """Auto-generate a notification when admin tries something blocked."""
    ist = pytz.timezone("Asia/Kolkata")
    now = datetime.now(ist)

    notification = {
        "title": "Unauthorized Action Blocked",
        "message": f"User {actor} tried to {action}.",
        "timestamp": now.strftime("%d-%m-%Y %H:%M:%S"),
        "status": "unread",
        "expireAt": now + timedelta(days=30)
    }

    result = await db["notifications"].insert_one(notification)
    notification["_id"] = str(result.inserted_id)

    # Push to live superadmins
    await notify_superadmins(notification)

@app.get("/notifications")
async def get_notifications(
    status: str = None,
    user_data: dict = Depends(verify_session_token)
):
    """Fetch notifications. Filter by status if provided."""
    query = {}
    if status:
        query["status"] = status

    notifications = await db["notifications"].find(query).sort("expireAt", -1).to_list(100)
    
    for n in notifications:
        n["_id"] = str(n["_id"])

    return notifications

@app.post("/notifications/read/{notification_id}")
async def mark_notification_read(
    notification_id: str,
    user_data: dict = Depends(verify_session_token)
):
    """Mark a notification as read by ID."""
    from bson import ObjectId
    result = await db["notifications"].update_one(
        {"_id": ObjectId(notification_id)},
        {"$set": {"status": "read"}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Notification not found")

    return {"success": True, "notification_id": notification_id}

@app.post("/notifications/read-all")
async def mark_all_notifications_read(user_data: dict = Depends(verify_session_token)):
    """Mark all unread notifications as read."""
    result = await db["notifications"].update_many(
        {"status": "unread"},
        {"$set": {"status": "read"}}
    )
    return {"success": True, "modified_count": result.modified_count}

@app.websocket("/notifications/ws")
async def websocket_endpoint(websocket: WebSocket):
    """Superadmin WebSocket connection for live notifications."""
    await websocket.accept()
    active_connections.append(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        active_connections.remove(websocket)

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

# ==============================
# AUTH ROUTES WITH CONSISTENT SESSION HANDLING
# ==============================

@app.get("/auth/google")
async def login_with_google():
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
    code = request.query_params.get("code")
    error = request.query_params.get("error")

    if error:
        if error == "access_denied":
            raise HTTPException(status_code=400, detail="User denied access")
        else:
            raise HTTPException(status_code=400, detail=f"OAuth error: {error}")

    if not code:
        raise HTTPException(status_code=400, detail="Authorization code not found")

    token_url = "https://oauth2.googleapis.com/token"
    token_data = {
        "code": code,
        "client_id": GOOGLE_CLIENT_ID,
        "client_secret": GOOGLE_CLIENT_SECRET,
        "redirect_uri": REDIRECT_URI,
        "grant_type": "authorization_code",
    }

    headers = {"Content-Type": "application/x-www-form-urlencoded"}

    try:
        async with httpx.AsyncClient() as client:
            token_response = await client.post(token_url, data=token_data, headers=headers)
            token_response.raise_for_status()
            token_json = token_response.json()
    except httpx.HTTPError as e:
        logger.error(f"Token request error: {e}")
        raise HTTPException(status_code=500, detail="Authentication failed")

    access_token = token_json.get("access_token")
    if not access_token:
        logger.error("Token response missing access_token")
        raise HTTPException(status_code=500, detail="Authentication failed")

    # Get user info
    try:
        async with httpx.AsyncClient() as client:
            userinfo_response = await client.get(
                "https://www.googleapis.com/oauth2/v2/userinfo",
                headers={"Authorization": f"Bearer {access_token}"}
            )
            userinfo_response.raise_for_status()
            user_info = userinfo_response.json()

            user_email = user_info["email"]
            role = "superadmin" if user_email in SUPERADMIN_EMAILS else "admin"
    except httpx.HTTPError as e:
        logger.error(f"Userinfo request error: {e}")
        raise HTTPException(status_code=500, detail="Authentication failed")

    # Create user data
    user_data = {
        "email": user_info["email"],
        "is_verified": user_info.get("verified_email", False),
        "name": user_info.get("name", ""),
        "picture": user_info.get("picture", ""),
        "role": role,
        "created_at": datetime.now(kolkata_tz).isoformat()
    }

    # Save user in MongoDB
    try:
        await collection.update_one(
            {"email": user_data["email"]},
            {"$set": user_data},
            upsert=True
        )
    except Exception as e:
        logger.error(f"MongoDB error: {e}")

    # Generate secure session token
    session_token = secrets.token_urlsafe(32)
    
    # Calculate expiration time for in-memory session
    expiry_time = datetime.now() + timedelta(seconds=SESSION_TTL_SECONDS)

    session_data = {
        "email": user_info["email"],
        "name": user_info.get("name", ""),
        "is_verified": user_info.get("verified_email", False),
        "role": role,
    }

    try:
        logger.info(f"Session created for user: {user_info['email']}")
        
        # Store session data and expiry in the in-memory dictionary
        active_sessions[session_token] = {
            "user_data": session_data,
            "expires_at": expiry_time
        }
        
    except Exception as e:
        logger.error(f"Session creation failed: {e}")
        raise HTTPException(status_code=500, detail="Session creation failed")

    params = {
        "token": session_token,
        "email": user_info["email"],
        "name": user_info.get("name", ""),
        "picture": user_info.get("picture", ""),
        "role": role,
    }
    
    if not FRONTEND_URL:
        raise HTTPException(status_code=500, detail="FRONTEND_URL not configured")
    
    # Redirect with the token for local storage
    redirect_url = f"{FRONTEND_URL}/?{urlencode(params)}"
    return RedirectResponse(url=redirect_url)

@app.post("/logout")
async def logout(request: Request):
    """
    Logout endpoint - deletes session from in-memory store
    Accepts token in request body
    """
    try:
        body = await request.json()
        token = body.get("token")

        if not token:
            raise HTTPException(status_code=400, detail="Token required")

        # Delete session from in-memory store
        if token in active_sessions:
            del active_sessions[token]
            logger.info(f"Session deleted for token: {token[:10]}...")
            return JSONResponse(content={
                "message": "Logged out successfully",
                "session_deleted": True
            })
        else:
            logger.warning(f"Session not found for token: {token[:10]}...")
            return JSONResponse(content={
                "message": "Session already expired or invalid",
                "session_deleted": False
            })

    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    except Exception as e:
        logger.error(f"Logout error: {e}")
        raise HTTPException(status_code=500, detail="Logout failed")

# ==============================
# EMPLOYEE ROUTES
# ==============================

@app.get("/employees/count")
async def get_employee_count(user_data: dict = Depends(verify_session_token)):
    """Get total employee count"""
    count = await db.employees.count_documents({})
    return {"count": count}

@app.post("/employees")
async def upload_employees(
    file: UploadFile = File(...),
    user_data: dict = Depends(require_admin)
):
    """Upload Excel file and safely insert/update employees."""
    
    # Check file size
    contents = await file.read()
    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="File too large (max 10MB)")

    suffix = os.path.splitext(file.filename)[-1]
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(contents)
        temp_path = tmp.name

    all_employees = []
    added, updated = 0, 0

    try:
        regular_sheets = [
            "ATTENDANCE_SSEE_SW_KGP_I",
            "ATTENDANCE_SSEE_SW_KGP_II",
            "ATTENDANCE_SSEE_SW_KGP_III",
        ]
        apprentice_sheet = "APPRENTICE ATTENDANCE"

        def read_sheet(sheet_name: str, skiprows: int, emp_type: str):
            try:
                df = pd.read_excel(temp_path, sheet_name=sheet_name, skiprows=skiprows)
                df.rename(columns={
                    "S. NO.": "S_No",
                    "NAME": "Name",
                    "DESIGNATION": "Designation",
                    "EMPLOYEE NO.": "Employee_No"
                }, inplace=True)
                df = df.dropna(subset=["Employee_No"])
                for _, row in df.iterrows():
                    all_employees.append({
                        "emp_no": clean_emp_no(row["Employee_No"]),
                        "name": sanitize_input(str(row["Name"])),
                        "designation": sanitize_input(str(row["Designation"])),
                        "type": emp_type,
                        "created_at": datetime.now(kolkata_tz).isoformat(),
                    })
            except Exception as e:
                logger.error(f"Error reading sheet {sheet_name}: {e}")

        for sheet in regular_sheets:
            read_sheet(sheet, skiprows=6, emp_type="regular")

        read_sheet(apprentice_sheet, skiprows=8, emp_type="apprentice")

        if not all_employees:
            raise HTTPException(status_code=400, detail="No employee data found")

        emp_collection = db["employees"]

        for emp in all_employees:
            cleaned_no = emp["emp_no"]
            existing = await emp_collection.find_one({"emp_no": cleaned_no})

            if existing:
                updates = {}
                if existing.get("name") != emp["name"].title():
                    updates["name"] = emp["name"].title()
                if existing.get("designation") != emp["designation"].title():
                    updates["designation"] = emp["designation"].title()
                if existing.get("type") != emp["type"]:
                    updates["type"] = emp["type"]

                if updates:
                    updates["updated_at"] = datetime.now(kolkata_tz).isoformat()
                    updates["updated_by"] = user_data.get("email")
                    await emp_collection.update_one({"emp_no": cleaned_no}, {"$set": updates})
                    updated += 1
            else:
                emp["name"] = emp["name"].title()
                emp["designation"] = emp["designation"].title()
                emp["created_by"] = user_data.get("email")
                await emp_collection.insert_one(emp)
                added += 1

        return {
            "message": "Employee data processed successfully",
            "summary": {
                "added": added,
                "updated": updated,
                "total_processed": len(all_employees),
            },
            "status": "success"
        }

    except Exception as e:
        logger.error(f"Error processing employees: {e}")
        raise HTTPException(status_code=500, detail="Error processing employees")

    finally:
        try:
            os.remove(temp_path)
        except Exception as e:
            logger.error(f"Temp file cleanup failed: {e}")

@app.post("/employees/manual")
async def add_employee_manual(
    employee: EmployeeCreate,
    user_data: dict = Depends(require_admin)
):
    """Manually add a single employee to the database"""
    
    cleaned_emp_no = clean_emp_no(employee.emp_no)

    emp_collection = db["employees"]
    existing_employee = await emp_collection.find_one({"emp_no": cleaned_emp_no})
    
    if existing_employee:
        raise HTTPException(status_code=409, detail=f"Employee {cleaned_emp_no} already exists")

    employee_data = {
        "emp_no": cleaned_emp_no,
        "name": employee.name.title(),
        "designation": employee.designation.title(),
        "type": employee.type,
        "created_by": user_data.get("email"),
        "created_at": datetime.now(kolkata_tz).isoformat(),
    }

    try:
        await emp_collection.insert_one(employee_data)
        employee_data.pop('_id', None)
        
        return {
            "message": f"Employee {employee.name.title()} added successfully",
            "employee": employee_data,
            "status": "success"
        }

    except Exception as e:
        logger.error(f"Error adding employee: {e}")
        raise HTTPException(status_code=500, detail="Database error")

@app.get("/employees")
async def get_employees(
    emp_type: str = None,
    search: str = None,
    limit: int = 100,
    skip: int = 0,
    user_data: dict = Depends(verify_session_token)
):
    """Get list of employees with optional filtering and search"""
    
    query = {}
    
    if emp_type and emp_type.lower() in ["regular", "apprentice"]:
        query["type"] = emp_type.lower()
    
    if search:
        search_regex = {"$regex": escape_regex(search), "$options": "i"}
        query["$or"] = [
            {"name": search_regex},
            {"emp_no": search_regex},
            {"designation": search_regex}
        ]

    emp_collection = db["employees"]
    
    try:
        total_count = await emp_collection.count_documents(query)
        cursor = emp_collection.find(query).skip(skip).limit(limit).sort("emp_no", 1)
        
        employees = []
        async for emp in cursor:
            emp.pop('_id', None)
            employees.append(emp)

        return {
            "message": "Employees retrieved successfully",
            "employees": employees,
            "pagination": {
                "total": total_count,
                "returned": len(employees),
                "skip": skip,
                "limit": limit
            }
        }

    except Exception as e:
        logger.error(f"Error retrieving employees: {e}")
        raise HTTPException(status_code=500, detail="Database error")

@app.put("/employees/{emp_no}")
async def update_employee(
    emp_no: str,
    request: Request,
    user_data: dict = Depends(require_superadmin)
):
    """Update an existing employee's information (superadmin only)"""
    
    try:
        body = await request.json()
    except:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    emp_collection = db["employees"]
    existing_employee = await emp_collection.find_one({"emp_no": emp_no})
    
    if not existing_employee:
        raise HTTPException(status_code=404, detail=f"Employee {emp_no} not found")

    update_data = {}
    
    if "name" in body and body["name"].strip():
        update_data["name"] = sanitize_input(body["name"]).title()
    
    if "designation" in body and body["designation"].strip():
        update_data["designation"] = sanitize_input(body["designation"]).title()
    
    if "type" in body and body["type"].lower() in ["regular", "apprentice"]:
        update_data["type"] = body["type"].lower()

    if not update_data:
        raise HTTPException(status_code=400, detail="No valid fields to update")

    update_data["updated_by"] = user_data.get("email")
    update_data["updated_at"] = datetime.now(kolkata_tz).strftime("%d-%m-%Y %H:%M:%S")

    try:
        result = await emp_collection.update_one(
            {"emp_no": emp_no},
            {"$set": update_data}
        )

        if result.modified_count == 0:
            raise HTTPException(status_code=500, detail="Update failed")

        updated_employee = await emp_collection.find_one({"emp_no": emp_no})
        updated_employee.pop('_id', None)

        return {
            "message": f"Employee {emp_no} updated successfully",
            "employee": updated_employee
        }

    except Exception as e:
        logger.error(f"Error updating employee: {e}")
        raise HTTPException(status_code=500, detail="Database error")

@app.delete("/employees/{emp_no}")
async def delete_employee(
    request: Request,
    emp_no: str,
    user_data: dict = Depends(require_superadmin)
):
    """Delete an employee (superadmin only)"""
    
    emp_collection = db["employees"]
    existing_employee = await emp_collection.find_one({"emp_no": emp_no})
    
    if not existing_employee:
        raise HTTPException(status_code=404, detail=f"Employee {emp_no} not found")

    employee_name = existing_employee.get("name", "Unknown")

    try:
        result = await emp_collection.delete_one({"emp_no": emp_no})

        if result.deleted_count == 0:
            raise HTTPException(status_code=500, detail="Delete failed")

        return {
            "message": f"Employee {employee_name} deleted successfully",
            "deleted_at": datetime.now(kolkata_tz).strftime("%d-%m-%Y %H:%M:%S")
        }

    except Exception as e:
        logger.error(f"Error deleting employee: {e}")
        raise HTTPException(status_code=500, detail="Database error")

# ==============================
# HOLIDAYS ROUTES
# ==============================

@app.post("/holidays")
async def upload_holidays(
    file: UploadFile = File(...),
    user_data: dict = Depends(require_admin)
):
    """
    Upload holidays Excel file.
    Accepts any sheet containing 'holiday' in its name (case-insensitive).
    """
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(file.filename)[-1]) as tmp:
            tmp.write(await file.read())
            temp_path = tmp.name

        # Read excel, find any sheet with 'holiday' in name
        xls = pd.ExcelFile(temp_path)
        sheet_name = None
        for s in xls.sheet_names:
            if "holiday" in s.lower():
                sheet_name = s
                break
        if not sheet_name:
            raise HTTPException(status_code=400, detail="No sheet containing 'holiday' found")

        df = pd.read_excel(xls, sheet_name=sheet_name)
        if df.empty:
            raise HTTPException(status_code=400, detail="Holiday sheet is empty")

        # Normalize column names
        df.columns = [str(c).strip().lower() for c in df.columns]

        # Detect date and name columns
        possible_date_cols = [c for c in df.columns if "date" in c]
        possible_name_cols = [c for c in df.columns if ("name" in c) or ("occasion" in c)]

        if not possible_date_cols or not possible_name_cols:
            raise HTTPException(status_code=400, detail="Expected columns containing 'date' and 'name'")

        date_col = possible_date_cols[0]
        name_col = possible_name_cols[0]

        df = df[[date_col, name_col]].dropna(subset=[date_col, name_col])
        df[date_col] = pd.to_datetime(df[date_col], dayfirst=True, errors="coerce")
        df = df[df[date_col].notna()]

        holidays = []
        for _, r in df.iterrows():
            dt = r[date_col].date()
            name = sanitize_input(str(r[name_col]))
            holidays.append({"date": dt.strftime("%Y-%m-%d"), "name": name})

        if not holidays:
            raise HTTPException(status_code=400, detail="No valid holidays found")

        hol_collection = db["holidays"]
        await hol_collection.delete_many({})
        await hol_collection.insert_many(holidays)

        try:
            os.remove(temp_path)
        except Exception:
            pass

        return {
            "message": f"{len(holidays)} holidays uploaded successfully",
            "uploaded_by": user_data.get("email"),
            "sheet": sheet_name
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error parsing holidays: {e}")
        raise HTTPException(status_code=500, detail=f"Error parsing holidays: {e}")

@app.get("/holidays")
async def get_holidays():
    """Get all holidays (public endpoint)"""
    holidays = []
    cursor = db["holidays"].find().sort("date", 1)
    async for doc in cursor:
        holidays.append({
            "date": datetime.strptime(doc["date"], "%Y-%m-%d").strftime("%d-%m-%Y"),
            "name": doc["name"]
        })
    return {"holidays": holidays}

# ==============================
# SHIFT MANAGEMENT
# ==============================

@app.post("/shift")
async def assign_shift(
    shift_data: ShiftAssign,
    user_data: dict = Depends(require_superadmin)
):
    """Assign shift to employee (superadmin only)"""
    
    employee = await db["employees"].find_one({"emp_no": shift_data.emp_no})
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")

    name = employee.get("name", "")

    shift_doc = {
        "emp_no": shift_data.emp_no,
        "name": name,
        "month": shift_data.month,
        "shift": shift_data.shift,
        "updated_by": user_data.get("email"),
        "updated_at": datetime.now(kolkata_tz).strftime("%d-%m-%Y %H:%M:%S")
    }

    shift_collection = db["shifts"]
    existing = await shift_collection.find_one({"emp_no": shift_data.emp_no, "month": shift_data.month})

    if existing:
        await shift_collection.replace_one({"_id": existing["_id"]}, shift_doc)
    else:
        await shift_collection.insert_one(shift_doc)

    return {"message": f"Shift updated for {name} ({shift_data.emp_no}) for {shift_data.month}"}

# ==============================
# ATTENDANCE MANAGEMENT
# ==============================

REGULAR_ATTENDANCE_LEGEND = {
    "P": "Present",
    "A": "Absent",
    "R": "Rest",
    "CL": "Casual Leave",
    "LAP": "Leave On Average Pay",
    "COCL": "Compensatory Casual Leave",
    "S": "Sick",
    "ART": "Accident Relief Train",
    "Trg": "Training",
    "SCL": "Special Casual Leave",
    "H": "Holiday",
    "D": "Duty",
    "Ex": "Exam",
    "Sp": "Spare",
    "Trans": "Transfer",
    "Retd": "Retired",
    "Rel": "Released"
}

APPRENTICE_ATTENDANCE_LEGEND = {
    "P": "Present",
    "A": "Absent",
    "R": "Rest",
    "S": "Sick",
    "CL": "Casual Leave",
    "REL": "Released"
}

@app.get("/attendance/legend")
async def get_attendance_legend():
    """Returns the legend of attendance codes"""
    return {
        "regular": REGULAR_ATTENDANCE_LEGEND,
        "apprentice": APPRENTICE_ATTENDANCE_LEGEND,
        "message": "Attendance code legends"
    }

@app.post("/attendance")
async def mark_attendance(
    attendance_data: AttendanceSubmit,
    user_data: dict = Depends(verify_session_token)
):
    """Mark attendance for an employee"""
    
    updated_by = user_data.get("email")
    role = user_data.get("role", "admin")

    try:
        year, month_num = map(int, attendance_data.month.split("-"))
    except:
        raise HTTPException(status_code=400, detail="Invalid month format")

    emp = await db["employees"].find_one({"emp_no": attendance_data.emp_no})
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    emp_name = emp.get("name", "")
    emp_type = emp.get("type", "").lower()

    if emp_type not in ["regular", "apprentice"]:
        raise HTTPException(status_code=400, detail="Invalid employee type")

    # Set attendance window and valid codes
    if emp_type == "regular":
        start_date = datetime(year, month_num, 11)
        end_date = datetime(year + 1, 1, 10) if month_num == 12 else datetime(year, month_num + 1, 10)
        valid_codes = REGULAR_ATTENDANCE_LEGEND.keys()
    elif emp_type == "apprentice":
        start_date = datetime(year, month_num, 1)
        end_day = calendar.monthrange(year, month_num)[1]
        end_date = datetime(year, month_num, end_day)
        valid_codes = APPRENTICE_ATTENDANCE_LEGEND.keys()

    # Validate each attendance record
    for date_str, code in attendance_data.attendance.items():
        try:
            date_obj = datetime.strptime(date_str, "%d-%m-%Y")
            if not (start_date.date() <= date_obj.date() <= end_date.date()):
                raise HTTPException(status_code=400, detail=f"Date {date_str} out of range")
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid date: {date_str}")

        if not any(code.startswith(valid) for valid in valid_codes):
            raise HTTPException(status_code=400, detail=f"Invalid code '{code}' for {emp_type}")

    attendance_collection = db["attendance"]
    existing = await attendance_collection.find_one({"emp_no": attendance_data.emp_no, "month": attendance_data.month})

    if existing and role != "superadmin":
        raise HTTPException(status_code=403, detail="Only superadmin can modify existing attendance")

    doc = {
        "emp_no": attendance_data.emp_no,
        "emp_name": emp_name,
        "type": emp_type,
        "month": attendance_data.month,
        "records": attendance_data.attendance,
        "updated_by": updated_by,
        "updated_at": datetime.now(kolkata_tz).strftime("%d-%m-%Y %H:%M:%S")
    }

    if existing:
        await attendance_collection.replace_one({"_id": existing["_id"]}, doc)
        action = "updated"
    else:
        await attendance_collection.insert_one(doc)
        action = "created"

    summary = {}
    for status in attendance_data.attendance.values():
        key = status.split("/")[0] if "/" in status else status
        summary[key] = summary.get(key, 0) + 1

    return {
        "message": f"Attendance {action} for {emp_name}",
        "status": action,
        "total_days": len(attendance_data.attendance),
        "summary": summary
    }

# ==============================
# BULK ATTENDANCE UPLOAD FROM EXCEL
# ==============================

@app.post("/attendance/upload")
async def upload_bulk_attendance(
    file: UploadFile = File(...),
    user_data: dict = Depends(require_admin)
):
    """
    Upload bulk attendance from Excel file.
    
    Expected Excel format:
    - First column: Employee Number
    - Subsequent columns: Dates (in DD-MM-YYYY format as headers)
    - Cell values: Attendance codes (P, A, CL, etc.)
    - Sheet name should contain month info or be specified
    
    Example:
    | Employee No | 11-07-2025 | 12-07-2025 | 13-07-2025 |
    |-------------|------------|------------|------------|
    | 12345       | P          | P          | A          |
    | 12346       | P          | CL         | P          |
    """
    
    # Check file size
    contents = await file.read()
    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="File too large (max 10MB)")

    suffix = os.path.splitext(file.filename)[-1]
    if suffix not in ['.xlsx', '.xls']:
        raise HTTPException(status_code=400, detail="Only Excel files (.xlsx, .xls) are supported")

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(contents)
        temp_path = tmp.name

    try:
        # Read the Excel file
        xls = pd.ExcelFile(temp_path)
        
        # Use first sheet or find attendance sheet
        sheet_name = xls.sheet_names[0]
        for s in xls.sheet_names:
            if "attendance" in s.lower():
                sheet_name = s
                break
        
        df = pd.read_excel(xls, sheet_name=sheet_name)
        
        if df.empty:
            raise HTTPException(status_code=400, detail="Excel sheet is empty")

        # Normalize column names
        df.columns = [str(col).strip() for col in df.columns]
        
        # Identify employee number column
        emp_col = None
        for col in df.columns:
            if any(keyword in col.lower() for keyword in ['emp', 'employee', 'no', 'number']):
                emp_col = col
                break
        
        if not emp_col:
            raise HTTPException(status_code=400, detail="Could not find employee number column")

        # Get date columns (all columns except employee column)
        date_columns = [col for col in df.columns if col != emp_col]
        
        if not date_columns:
            raise HTTPException(status_code=400, detail="No date columns found")

        # Parse dates and determine month
        parsed_dates = {}
        months_found = set()
        
        for col in date_columns:
            try:
                # Try parsing the column name as a date
                date_obj = pd.to_datetime(col, dayfirst=True, errors='coerce')
                if pd.notna(date_obj):
                    date_str = date_obj.strftime("%d-%m-%Y")
                    parsed_dates[col] = date_str
                    month_key = date_obj.strftime("%Y-%m")
                    months_found.add(month_key)
            except:
                logger.warning(f"Could not parse column as date: {col}")
                continue
        
        if not parsed_dates:
            raise HTTPException(status_code=400, detail="Could not parse any date columns")
        
        if len(months_found) > 1:
            raise HTTPException(status_code=400, detail=f"Multiple months found in data: {months_found}. Please upload one month at a time.")
        
        month = list(months_found)[0]
        
        # Process each employee row
        processed_count = 0
        error_count = 0
        errors = []
        
        emp_collection = db["employees"]
        attendance_collection = db["attendance"]
        
        for idx, row in df.iterrows():
            try:
                emp_no = clean_emp_no(row[emp_col])
                
                if not emp_no or pd.isna(emp_no):
                    continue
                
                # Get employee details
                emp = await emp_collection.find_one({"emp_no": emp_no})
                if not emp:
                    errors.append(f"Row {idx+2}: Employee {emp_no} not found in database")
                    error_count += 1
                    continue
                
                emp_name = emp.get("name", "")
                emp_type = emp.get("type", "").lower()
                
                # Build attendance records
                attendance_records = {}
                for original_col, date_str in parsed_dates.items():
                    attendance_code = str(row[original_col]).strip().upper()
                    
                    # Skip empty cells
                    if pd.isna(row[original_col]) or attendance_code in ['', 'NAN', 'NONE']:
                        continue
                    
                    # Validate attendance code
                    valid_codes = REGULAR_ATTENDANCE_LEGEND.keys() if emp_type == "regular" else APPRENTICE_ATTENDANCE_LEGEND.keys()
                    
                    if not any(attendance_code.startswith(valid) for valid in valid_codes):
                        errors.append(f"Row {idx+2}, Employee {emp_no}: Invalid code '{attendance_code}' for {emp_type}")
                        continue
                    
                    attendance_records[date_str] = attendance_code
                
                if not attendance_records:
                    errors.append(f"Row {idx+2}: No valid attendance data for employee {emp_no}")
                    error_count += 1
                    continue
                
                # Check if attendance already exists
                existing = await attendance_collection.find_one({"emp_no": emp_no, "month": month})
                
                if existing and user_data.get("role") != "superadmin":
                    errors.append(f"Row {idx+2}: Attendance for {emp_no} already exists. Only superadmin can modify.")
                    error_count += 1
                    continue
                
                # Save attendance
                doc = {
                    "emp_no": emp_no,
                    "emp_name": emp_name,
                    "type": emp_type,
                    "month": month,
                    "records": attendance_records,
                    "updated_by": user_data.get("email"),
                    "updated_at": datetime.now(kolkata_tz).strftime("%d-%m-%Y %H:%M:%S")
                }
                
                if existing:
                    await attendance_collection.replace_one({"_id": existing["_id"]}, doc)
                else:
                    await attendance_collection.insert_one(doc)
                
                processed_count += 1
                
            except Exception as e:
                logger.error(f"Error processing row {idx+2}: {e}")
                errors.append(f"Row {idx+2}: {str(e)}")
                error_count += 1
                continue
        
        # Clean up temp file
        try:
            os.remove(temp_path)
        except Exception as e:
            logger.error(f"Temp file cleanup failed: {e}")
        
        return {
            "message": "Bulk attendance upload completed",
            "summary": {
                "total_rows": len(df),
                "processed": processed_count,
                "errors": error_count,
                "month": month
            },
            "errors": errors[:50] if errors else [],
            "uploaded_by": user_data.get("email")
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error processing bulk attendance: {e}")
        raise HTTPException(status_code=500, detail=f"Error processing file: {str(e)}")
    finally:
        try:
            os.remove(temp_path)
        except:
            pass

@app.get("/attendance")
async def get_attendance(
    emp_no: str = None,
    month: str = None,
    user_data: dict = Depends(verify_session_token)
):
    """Get attendance records with optional filters"""
    
    filter_query = {}

    if emp_no:
        employee = await db["employees"].find_one({"emp_no": emp_no})
        if not employee:
            raise HTTPException(status_code=404, detail=f"Employee {emp_no} not found")
        filter_query["emp_no"] = emp_no

    if month:
        try:
            year, month_num = map(int, month.split("-"))
            if not (1 <= month_num <= 12):
                raise ValueError()
        except:
            raise HTTPException(status_code=400, detail="Month format: YYYY-MM")
        filter_query["month"] = month

    attendance_records = []
    cursor = db["attendance"].find(filter_query).sort("month", -1)

    async for record in cursor:
        record.pop('_id', None)

        summary = {}
        for attendance_code in record.get("records", {}).values():
            code = attendance_code.split("/")[0] if "/" in attendance_code else attendance_code
            summary[code] = summary.get(code, 0) + 1

        record["summary"] = summary
        record["total_days"] = len(record.get("records", {}))

        attendance_records.append(record)

    if not attendance_records:
        return {
            "message": "No attendance records found",
            "data": [],
            "count": 0
        }

    return {
        "message": "Attendance records retrieved",
        "data": attendance_records,
        "count": len(attendance_records)
    }

@app.get("/attendance/monthly")
async def get_monthly_summary(
    month: str,
    user_data: dict = Depends(verify_session_token)
):
    """Get monthly attendance summary"""
    
    try:
        year, month_num = map(int, month.split("-"))
        if not (1 <= month_num <= 12):
            raise ValueError()
    except:
        raise HTTPException(status_code=400, detail="Month format: YYYY-MM")

    records = []
    cursor = db["attendance"].find({"month": month}).sort("emp_no", 1)

    async for record in cursor:
        summary = {}
        for code in record.get("records", {}).values():
            clean_code = code.split("/")[0] if "/" in code else code
            summary[clean_code] = summary.get(clean_code, 0) + 1

        records.append({
            "emp_no": record.get("emp_no"),
            "name": record.get("emp_name"),
            "type": record.get("type"),
            "total_days": len(record.get("records", {})),
            "breakdown": summary
        })

    if not records:
        return {
            "message": f"No data for {month}",
            "month": month,
            "employees": [],
            "total_employees": 0
        }

    return {
        "message": f"Monthly summary for {month}",
        "month": month,
        "employees": records,
        "total_employees": len(records)
    }

@app.get("/attendance/employee/{emp_no}")
async def get_employee_history(
    emp_no: str,
    user_data: dict = Depends(verify_session_token)
):
    """Get attendance history for a specific employee"""
    
    employee = await db["employees"].find_one({"emp_no": emp_no})
    if not employee:
        raise HTTPException(status_code=404, detail=f"Employee {emp_no} not found")

    history = []
    cursor = db["attendance"].find({"emp_no": emp_no}).sort("month", -1)

    async for record in cursor:
        record.pop('_id', None)

        summary = {}
        for code in record.get("records", {}).values():
            clean_code = code.split("/")[0] if "/" in code else code
            summary[clean_code] = summary.get(clean_code, 0) + 1

        record["summary"] = summary
        history.append(record)

    return {
        "message": f"History for {employee['name']}",
        "employee": {
            "emp_no": emp_no,
            "name": employee["name"],
            "designation": employee["designation"],
            "type": employee["type"]
        },
        "history": history,
        "total_months": len(history)
    }

# ==============================
# EXPORT ROUTES
# ==============================

@app.get("/export_regular")
async def export_regular(
    month: str = "2025-07",
    user_data: dict = Depends(verify_session_token)
):
    """Export regular employee attendance to Excel"""
    stream = await create_attendance_excel(db, "regular", month)
    return StreamingResponse(
        stream, 
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=regular_attendance_{month}.xlsx"}
    )

@app.get("/export_apprentice")
async def export_apprentice(
    month: str = "2025-07",
    user_data: dict = Depends(verify_session_token)
):
    """Export apprentice attendance to Excel"""
    stream = await create_attendance_excel(db, "apprentice", month)
    return StreamingResponse(
        stream,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=apprentice_attendance_{month}.xlsx"}
    )

# ==============================
# STARTUP EVENTS
# ==============================

@app.on_event("startup")
async def setup_indexes():
    """Create database indexes for faster queries"""
    await db["attendance"].create_index([("emp_no", 1), ("month", 1)], unique=True)
    await db["employees"].create_index("emp_no")
    await db["shifts"].create_index([("emp_no", 1), ("month", 1)])
    logger.info("Database indexes created")
