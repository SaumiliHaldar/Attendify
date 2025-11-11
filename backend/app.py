from fastapi import FastAPI, Request, HTTPException, APIRouter, WebSocket, WebSocketDisconnect, Response
from fastapi.responses import RedirectResponse, JSONResponse, StreamingResponse
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
import os
import json
import httpx
import pytz
from datetime import datetime, timedelta
from typing import Dict
import calendar
from io import BytesIO
from excelmaker import create_attendance_excel
from sessions import create_session, get_session, delete_session, cleanup_expired_sessions
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

# Employee sheet
EMPLOYEE_SHEET = "./ATTENDANCE SHEET MUSTER ROLL OF SSEE SW KGP.xlsx"

# ==============================
# Security Helper Functions
# ==============================

async def verify_session(request: Request, response: Response = None) -> dict:
    """
    Centralized session verification using sessions.py
    - checks session cookie via get_session()
    - returns user data if valid
    - raises HTTPException if invalid/expired
    """
    user_data = await get_session(request, response)
    
    if not user_data:
        raise HTTPException(status_code=403, detail="Session expired or invalid")
    
    return user_data

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

async def get_current_user(request: Request, response: Response = None):
    """
    Backwards-compatible wrapper for verify_session
    """
    return await verify_session(request, response)

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
async def get_notifications(request: Request, response: Response, status: str = None):
    """Fetch notifications. Filter by status if provided."""
    await verify_session(request, response)
    
    query = {}
    if status:
        query["status"] = status

    notifications = await db["notifications"].find(query).sort("expireAt", -1).to_list(100)
    
    # Convert ObjectId → string for all results
    for n in notifications:
        n["_id"] = str(n["_id"])

    return notifications

@app.post("/notifications/read/{notification_id}")
async def mark_notification_read(notification_id: str, request: Request, response: Response):
    """Mark a notification as read by ID."""
    await verify_session(request, response)
    
    from bson import ObjectId
    result = await db["notifications"].update_one(
        {"_id": ObjectId(notification_id)},
        {"$set": {"status": "read"}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Notification not found")

    return {"success": True, "notification_id": notification_id}

@app.post("/notifications/read-all")
async def mark_all_notifications_read(request: Request, response: Response):
    """Mark all unread notifications as read."""
    await verify_session(request, response)
    
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

# Google Auth Signin/Signup
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
async def google_callback(request: Request, response: Response):
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

    # Create session using sessions.py
    try:
        session_id = await create_session(response, user_data)
        logger.info(f"Session created for user: {user_info['email']}")
    except Exception as e:
        logger.error(f"Session creation error: {e}")
        raise HTTPException(status_code=500, detail="Session creation failed")

    params = {
        "email": user_info["email"],
        "name": user_info.get("name", ""),
        "picture": user_info.get("picture", ""),
        "role": role,
    }
    
    if not FRONTEND_URL:
        raise HTTPException(status_code=500, detail="FRONTEND_URL not configured")
    
    redirect_url = f"{FRONTEND_URL}/?{urlencode(params)}"
    return RedirectResponse(url=redirect_url)

# Logout and session cleared
@app.post("/logout")
async def logout(request: Request, response: Response):
    try:
        await delete_session(request, response)
        return JSONResponse(content={"message": "Logged out successfully"})
    except Exception as e:
        logger.error(f"Logout error: {e}")
        raise HTTPException(status_code=500, detail="Logout failed")

# Get employee count
@app.get("/employees/count")
async def get_employee_count(request: Request, response: Response):
    await verify_session(request, response)
    count = await db.employees.count_documents({})
    return {"count": count}

# Load employees (Excel upload)
@app.post("/employees")
async def upload_employees(request: Request, response: Response, file: UploadFile = File(...)):
    """Upload Excel file and safely insert/update employees."""
    import tempfile

    user_data = await verify_session(request, response)
    user_role = user_data.get("role", "admin")
    
    if user_role not in ["admin", "superadmin"]:
        raise HTTPException(status_code=403, detail="Admin access required")

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

# Manual employee addition
@app.post("/employees/manual")
async def add_employee_manual(employee: EmployeeCreate, request: Request, response: Response):
    """Manually add a single employee to the database"""
    user_data = await verify_session(request, response)
    user_role = user_data.get("role", "admin")
    
    if user_role not in ["admin", "superadmin"]:
        raise HTTPException(status_code=403, detail="Admin access required")

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

# Get employees with filtering and search
@app.get("/employees")
async def get_employees(
    request: Request,
    response: Response,
    emp_type: str = None,
    search: str = None,
    limit: int = 100,
    skip: int = 0
):
    """Get list of employees with optional filtering and search"""
    await verify_session(request, response)

    query = {}
    
    if emp_type and emp_type.lower() in ["regular", "apprentice"]:
        query["type"] = emp_type.lower()
    
    if search:
        # SECURE: Escape regex special characters
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

# Update employee
@app.put("/employees/{emp_no}")
async def update_employee(
    emp_no: str,
    request: Request,
    response: Response
):
    """Update an existing employee's information (superadmin only)"""
    user_data = await verify_session(request, response)

    if user_data.get("role") != "superadmin":
        await auto_notify(request, user_data.get("email"), f"update employee {emp_no}")
        raise HTTPException(status_code=403, detail="Superadmin access required")

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

# Delete employee
@app.delete("/employees/{emp_no}")
async def delete_employee(
    request: Request,
    response: Response,
    emp_no: str
):
    """Delete an employee (superadmin only)"""
    user_data = await verify_session(request, response)

    if user_data.get("role") != "superadmin":
        await auto_notify(request, user_data.get("email"), f"delete employee {emp_no}")
        raise HTTPException(status_code=403, detail="Superadmin access required")

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

# Load holidays
@app.post("/holidays")
async def upload_holidays(request: Request, response: Response, file: UploadFile = File(...)):
    """
    Upload holidays Excel file.
    Accepts any sheet containing 'holiday' in its name (case-insensitive).
    Requires admin or superadmin role.
    Stores holidays with 'date' as YYYY-MM-DD strings and 'name'.
    """
    try:
        user = await verify_session(request, response)
        role = user.get("role", "")
        if role not in ("admin", "superadmin"):
            raise HTTPException(status_code=403, detail="Not authorized")

        # Save file to temp
        import tempfile
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

        # Normalize column names (make lower-case)
        df.columns = [str(c).strip().lower() for c in df.columns]

        # Accept flexible names - try to detect date and name columns
        possible_date_cols = [c for c in df.columns if "date" in c]
        possible_name_cols = [c for c in df.columns if ("name" in c) or ("occasion" in c) or ("occasion name" in c)]

        if not possible_date_cols or not possible_name_cols:
            raise HTTPException(status_code=400, detail="Expected columns containing 'date' and 'name'")

        date_col = possible_date_cols[0]
        name_col = possible_name_cols[0]

        df = df[[date_col, name_col]].dropna(subset=[date_col, name_col])
        # Convert dates to ISO yyyy-mm-dd strings
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
        await hol_collection.delete_many({})  # clear existing
        await hol_collection.insert_many(holidays)

        try:
            os.remove(temp_path)
        except Exception:
            pass

        return {"message": f"{len(holidays)} holidays uploaded successfully", "uploaded_by": user.get("email"), "sheet": sheet_name}

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error parsing holidays: {e}")
        raise HTTPException(status_code=500, detail=f"Error parsing holidays: {e}")

# Fetch holidays
@app.get("/holidays")
async def get_holidays():
    holidays = []
    cursor = db["holidays"].find().sort("date", 1)
    async for doc in cursor:
        holidays.append({
            "date": datetime.strptime(doc["date"], "%Y-%m-%d").strftime("%d-%m-%Y"),
            "name": doc["name"]
        })
    return {"holidays": holidays}

# Shift management
@app.post("/shift")
async def assign_shift(shift_data: ShiftAssign, request: Request, response: Response):
    user_data = await verify_session(request, response)

    if user_data.get("role") != "superadmin":
        raise HTTPException(status_code=403, detail="Superadmin access required")

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

# Attendance management
attendance = APIRouter()

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

@attendance.post("/attendance")
async def mark_attendance(attendance_data: AttendanceSubmit, request: Request, response: Response):
    user_data = await verify_session(request, response)
    
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

app.include_router(attendance)

# Index creation for faster queries
@app.on_event("startup")
async def setup_indexes():
    await db["attendance"].create_index([("emp_no", 1), ("month", 1)], unique=True)
    await db["employees"].create_index("emp_no")
    await db["shifts"].create_index([("emp_no", 1), ("month", 1)])
    logger.info("Database indexes created")

# Attendance legend
@app.get("/attendance/legend")
async def get_attendance_legend():
    """Returns the legend of attendance codes"""
    return {
        "regular": REGULAR_ATTENDANCE_LEGEND,
        "apprentice": APPRENTICE_ATTENDANCE_LEGEND,
        "message": "Attendance code legends"
    }

# Retrieve attendance data
@app.get("/attendance")
async def get_attendance(
    request: Request,
    response: Response,
    emp_no: str = None,
    month: str = None
):
    await verify_session(request, response)

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

# Monthly attendance summary
@app.get("/attendance/monthly")
async def get_monthly_summary(
    month: str,
    request: Request,
    response: Response
):
    await verify_session(request, response)

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

# Employee attendance history
@app.get("/attendance/employee/{emp_no}")
async def get_employee_history(
    emp_no: str,
    request: Request,
    response: Response
):
    await verify_session(request, response)

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

# Export attendance records
@app.get("/export_regular")
async def export_regular(month: str = "2025-07", request: Request = None, response: Response = None):
    await verify_session(request, response)
    stream = await create_attendance_excel(db, "regular", month)
    return StreamingResponse(
        stream, 
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=regular_attendance_{month}.xlsx"}
    )

@app.get("/export_apprentice")
async def export_apprentice(month: str = "2025-07", request: Request = None, response: Response = None):
    await verify_session(request, response)
    stream = await create_attendance_excel(db, "apprentice", month)
    return StreamingResponse(
        stream,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=apprentice_attendance_{month}.xlsx"}
    )
