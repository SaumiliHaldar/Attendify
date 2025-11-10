from fastapi import FastAPI, Request, HTTPException, APIRouter, WebSocket, WebSocketDisconnect
from fastapi.responses import RedirectResponse, JSONResponse, StreamingResponse
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
import os
import json
import httpx
import pytz
import logging
from datetime import datetime, timedelta
from typing import Dict
import calendar
from io import BytesIO
from excelmaker import create_attendance_excel
from sessions import create_session, get_session, delete_session
import pandas as pd
from fastapi import UploadFile, File, Header
from fastapi.middleware.cors import CORSMiddleware
from urllib.parse import urlencode


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

# Configurable superadmin emails and allowed origins
SUPERADMINS = [email.strip() for email in os.getenv("SUPERADMIN_EMAILS", "").split(",") if email.strip()]
ALLOWED_ORIGINS = [origin.strip() for origin in os.getenv("ALLOWED_ORIGINS", "*").split(",") if origin.strip()]


# Timezone setup for Kolkata
kolkata_tz = pytz.timezone("Asia/Kolkata")

# App CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Employee sheet
EMPLOYEE_SHEET = "./ATTENDANCE SHEET MUSTER ROLL OF SSEE SW KGP.xlsx"

# Routes
@app.get("/healthz")
async def health_check():
    return {"message": "Attendify is active!", "status": "OK"}

# ==============================
# Notifications Section
# ==============================
active_connections: list[WebSocket] = []

async def notify_superadmins(message: dict):
    """
    Push a notification to all connected superadmin sockets.
    """
    for connection in active_connections:
        try:
            await connection.send_text(json.dumps(message))
        except:
            continue

async def auto_notify(request: Request, actor: str, action: str):
    """
    Auto-generate a notification when admin tries something blocked.
    Uses Asia/Kolkata timezone and dd-mm-yyyy HH:MM:SS format.
    """
    ist = pytz.timezone("Asia/Kolkata")
    now = datetime.now(ist)

    notification = {
        "title": "Unauthorized Action Blocked",
        "message": f"User {actor} tried to {action}.",
        "timestamp": now.strftime("%d-%m-%Y %H:%M:%S"),  # Kolkata format
        "status": "unread",
        "expireAt": now + timedelta(days=30)  # Kolkata time + 30 days
    }

    result = await db["notifications"].insert_one(notification)
    notification["_id"] = str(result.inserted_id)

    # Push to live superadmins
    await notify_superadmins(notification)

@app.get("/notifications")
async def get_notifications(status: str = None):
    """
    Fetch notifications. Filter by status if provided.
    """
    query = {}
    if status:
        query["status"] = status

    notifications = await db["notifications"].find(query).sort("expireAt", -1).to_list(100)

    # Convert ObjectId → string for all results
    for n in notifications:
        n["_id"] = str(n["_id"])

    return notifications

@app.post("/notifications/read/{notification_id}")
async def mark_notification_read(notification_id: str):
    """
    Mark a notification as read by ID.
    """
    from bson import ObjectId
    result = await db["notifications"].update_one(
        {"_id": ObjectId(notification_id)},
        {"$set": {"status": "read"}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Notification not found")

    return {"success": True, "notification_id": notification_id}

@app.post("/notifications/read-all")
async def mark_all_notifications_read():
    """
    Mark all unread notifications as read.
    """
    result = await db["notifications"].update_many(
        {"status": "unread"},
        {"$set": {"status": "read"}}
    )
    return {"success": True, "modified_count": result.modified_count}

@app.websocket("/notifications/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    Superadmin WebSocket connection for live notifications.
    """
    await websocket.accept()
    active_connections.append(websocket)
    try:
        while True:
            await websocket.receive_text()  # keep alive
    except WebSocketDisconnect:
        active_connections.remove(websocket)


# Home Route
@app.get("/")
async def home():
    # Get today's date and current month using Kolkata timezone
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

    # Holidays from DB (store in YYYY-MM-DD for sorting, format for display)
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

    # Attendance snapshot logic for home page
    from collections import defaultdict

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
async def google_callback(request: Request):
    code = request.query_params.get("code")
    error = request.query_params.get("error")

    if error:
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

    try:
        async with httpx.AsyncClient() as client:
            token_response = await client.post(token_url, data=token_data)
            token_response.raise_for_status()
            token_json = token_response.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=500, detail=f"Token request failed: {str(e)}")

    access_token = token_json.get("access_token")
    if not access_token:
        raise HTTPException(status_code=500, detail="Access token missing")

    # Fetch user info
    async with httpx.AsyncClient() as client:
        userinfo_response = await client.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {access_token}"}
        )
        userinfo_response.raise_for_status()
        user_info = userinfo_response.json()

    user_email = user_info["email"]
    role = "superadmin" if user_email in SUPERADMINS else "admin"
    if role == "superadmin":
        print(f"[AUTH] Superadmin logged in: {user_email}")

    # Store or update in DB
    user_data = {
        "email": user_email,
        "is_verified": user_info.get("verified_email", False),
        "name": user_info.get("name", ""),
        "picture": user_info.get("picture", ""),
        "role": role,
        "created_at": datetime.now(kolkata_tz).isoformat()
    }

    try:
        existing_user = await collection.find_one({"email": user_email})
        if not existing_user:
            await collection.insert_one(user_data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB error: {str(e)}")

    # Create session
    session_data = {
        "email": user_email,
        "name": user_info.get("name", ""),
        "is_verified": user_info.get("verified_email", False),
        "role": role
    }

    response = RedirectResponse(url=f"{FRONTEND_URL}/?{urlencode(session_data)}")
    await create_session(response, session_data)
    return response


# Logout and session cleared
@app.post("/logout")
async def logout(request: Request):
    """
    Logout endpoint — clears the user's session and cookie.
    """
    try:
        response = JSONResponse(content={"message": "User logged out successfully."})
        await delete_session(request, response)
        return response
    except Exception as e:
        print(f"Logout error: {e}")
        raise HTTPException(status_code=500, detail="Logout failed")


# Helper function to clean employee number
def clean_emp_no(emp_no):
    """Remove .0 from employee numbers and clean whitespace"""
    emp_str = str(emp_no).strip()
    # Remove .0 if it exists at the end
    if emp_str.endswith('.0'):
        emp_str = emp_str[:-2]
    return emp_str

# Get employee count
@app.get("/employees/count")
async def get_employee_count():
    count = await db.employees.count_documents({})
    return {"count": count}

# Load employees (Excel upload)
@app.post("/employees")
async def upload_employees(file: UploadFile = File(...)):
    import tempfile

    suffix = os.path.splitext(file.filename)[-1]
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        contents = await file.read()
        tmp.write(contents)
        temp_path = tmp.name

    all_employees = []
    try:
        regular_sheets = [
            "ATTENDANCE_SSEE_SW_KGP_I",
            "ATTENDANCE_SSEE_SW_KGP_II",
            "ATTENDANCE_SSEE_SW_KGP_III"
        ]
        apprentice_sheet = "APPRENTICE ATTENDANCE"

        # Regular Employees
        for sheet in regular_sheets:
            try:
                df = pd.read_excel(temp_path, sheet_name=sheet, skiprows=6)
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
                        "name": str(row["Name"]).strip(),
                        "designation": str(row["Designation"]).strip(),
                        "type": "regular",
                        "created_at": datetime.now(kolkata_tz).isoformat()
                    })
            except Exception as e:
                print(f"Error reading regular sheet {sheet}: {e}")
                continue

        # Apprentice Employees
        try:
            df = pd.read_excel(temp_path, sheet_name=apprentice_sheet, skiprows=8)
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
                    "name": str(row["Name"]).strip(),
                    "designation": str(row["Designation"]).strip(),
                    "type": "apprentice",
                    "created_at": datetime.now(kolkata_tz).isoformat()
                })
        except Exception as e:
            print(f"Error reading apprentice sheet: {e}")

        if not all_employees:
            raise HTTPException(status_code=400, detail="No employee data found.")

        # Print some employee numbers for debugging
        print(f"Sample employee numbers: {[emp['emp_no'] for emp in all_employees[:5]]}")

        emp_collection = db["employees"]
        await emp_collection.delete_many({})
        await emp_collection.insert_many(all_employees)

        return {"message": f"{len(all_employees)} employees uploaded successfully."}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing employees: {e}")

    finally:
        os.remove(temp_path)


# Manual employee addition@app.post("/employees/manual")
async def add_employee_manual(request: Request):
    """
    Manually add a single employee to the database
    Requires admin or superadmin authentication
    """
    session = await get_session(request)
    if not session:
        raise HTTPException(status_code=403, detail="Session expired. Please login again.")

    user_email = session["email"]
    user_role = session["role"]

    # Only allow admins and superadmins
    if user_role not in ["admin", "superadmin"]:
        raise HTTPException(status_code=403, detail="Insufficient privileges. Admin access required.")

    try:
        body = await request.json()
    except:
        raise HTTPException(status_code=400, detail="Invalid JSON format")

    emp_no = body.get("emp_no", "").strip()
    name = body.get("name", "").strip()
    designation = body.get("designation", "").strip()
    emp_type = body.get("type", "").strip().lower()

    if not emp_no or not name or not designation or emp_type not in ["regular", "apprentice"]:
        raise HTTPException(status_code=400, detail="Missing or invalid employee data")

    cleaned_emp_no = clean_emp_no(emp_no)
    emp_collection = db["employees"]
    existing_employee = await emp_collection.find_one({"emp_no": cleaned_emp_no})

    if existing_employee:
        raise HTTPException(status_code=409, detail=f"Employee with number {cleaned_emp_no} already exists")

    employee_data = {
        "emp_no": cleaned_emp_no,
        "name": name.title(),
        "designation": designation.title(),
        "type": emp_type,
        "created_by": user_email,
        "created_at": datetime.now(kolkata_tz).isoformat(),
    }

    await emp_collection.insert_one(employee_data)

    return {
        "message": f"Employee {name.title()} ({cleaned_emp_no}) added successfully",
        "employee": employee_data,
        "added_by": session.get("name", user_email),
        "status": "success"
    }


# Get employees with filtering and search@app.get("/employees")
async def get_employees(
    request: Request,
    emp_type: str = None,
    search: str = None,
    limit: int = 100,
    skip: int = 0
):
    session = await get_session(request)
    if not session:
        raise HTTPException(status_code=403, detail="Session expired. Please login again.")

    query = {}
    if emp_type and emp_type.lower() in ["regular", "apprentice"]:
        query["type"] = emp_type.lower()

    if search:
        search_regex = {"$regex": search, "$options": "i"}
        query["$or"] = [
            {"name": search_regex},
            {"emp_no": search_regex},
            {"designation": search_regex}
        ]

    emp_collection = db["employees"]
    total_count = await emp_collection.count_documents(query)
    cursor = emp_collection.find(query).skip(skip).limit(limit).sort("emp_no", 1)

    employees = []
    async for emp in cursor:
        emp.pop("_id", None)
        employees.append(emp)

    return {
        "message": "Employees retrieved successfully",
        "employees": employees,
        "pagination": {"total": total_count, "returned": len(employees), "skip": skip, "limit": limit},
        "filters_applied": {"type": emp_type, "search": search}
    }


# Update employee
@app.put("/employees/{emp_no}")
async def update_employee(emp_no: str, request: Request):
    session = await get_session(request)
    if not session:
        raise HTTPException(status_code=403, detail="Session expired.")

    user_email = session["email"]
    user_role = session["role"]

    if user_role != "superadmin":
        await auto_notify(request, user_email, f"update employee {emp_no}")
        raise HTTPException(status_code=403, detail="Only superadmins can update employees")

    try:
        body = await request.json()
    except:
        raise HTTPException(status_code=400, detail="Invalid JSON format")

    emp_collection = db["employees"]
    existing_employee = await emp_collection.find_one({"emp_no": emp_no})
    if not existing_employee:
        raise HTTPException(status_code=404, detail=f"Employee {emp_no} not found")

    update_data = {}
    if "name" in body and body["name"].strip():
        update_data["name"] = body["name"].strip().title()
    if "designation" in body and body["designation"].strip():
        update_data["designation"] = body["designation"].strip().title()
    if "type" in body and body["type"].lower() in ["regular", "apprentice"]:
        update_data["type"] = body["type"].lower()

    if not update_data:
        raise HTTPException(status_code=400, detail="No valid fields to update")

    update_data["updated_by"] = user_email
    update_data["updated_at"] = datetime.now(kolkata_tz).strftime("%d-%m-%Y %H:%M:%S")

    await emp_collection.update_one({"emp_no": emp_no}, {"$set": update_data})
    updated_employee = await emp_collection.find_one({"emp_no": emp_no})
    updated_employee.pop("_id", None)

    return {
        "message": f"Employee {emp_no} updated successfully",
        "employee": updated_employee,
        "updated_by": session.get("name", user_email),
        "updated_fields": list(update_data.keys())
    }

# Delete employee
@app.delete("/employees/{emp_no}")
async def delete_employee(request: Request, emp_no: str):
    session = await get_session(request)
    if not session:
        raise HTTPException(status_code=403, detail="Session expired.")

    user_email = session["email"]
    user_role = session["role"]

    if user_role != "superadmin":
        await auto_notify(request, user_email, f"delete employee {emp_no}")
        raise HTTPException(status_code=403, detail="Only superadmins can delete employees")

    emp_collection = db["employees"]
    existing_employee = await emp_collection.find_one({"emp_no": emp_no})
    if not existing_employee:
        raise HTTPException(status_code=404, detail=f"Employee {emp_no} not found")

    employee_name = existing_employee.get("name", "Unknown")
    await emp_collection.delete_one({"emp_no": emp_no})

    return {
        "message": f"Employee {employee_name} ({emp_no}) deleted successfully",
        "deleted_by": session.get("name", user_email),
        "deleted_at": datetime.now(kolkata_tz).strftime("%d-%m-%Y %H:%M:%S")
    }


# Load holidays
@app.post("/holidays")
async def upload_holidays(file: UploadFile = File(...)):
    import tempfile

    # Save the uploaded Excel file temporarily
    suffix = os.path.splitext(file.filename)[-1]
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        contents = await file.read()
        tmp.write(contents)
        temp_path = tmp.name

    holidays = []
    try:
        # Read HOLIDAYS sheet using second row as header
        df = pd.read_excel(temp_path, sheet_name="HOLIDAYS", header=1)
        df_filtered = df.dropna(subset=['Name of the Occasion', 'Date'])

        for _, row in df_filtered.iterrows():
            raw_date = str(row["Date"]).strip()
            name = str(row["Name of the Occasion"]).strip()
            date = pd.to_datetime(raw_date, dayfirst=True, errors="coerce")
            if pd.notna(date):
                holidays.append({
                    # Storing in YYYY-MM-DD for database consistency and sorting
                    "date": date.strftime("%Y-%m-%d"),
                    "name": name
                })

        if not holidays:
            raise HTTPException(status_code=400, detail="No valid holidays found.")

        hol_collection = db["holidays"]
        await hol_collection.delete_many({})
        await hol_collection.insert_many(holidays)

        return {"message": f"{len(holidays)} holidays uploaded successfully."}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error parsing holidays: {e}")

    finally:
        os.remove(temp_path)


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
async def assign_shift(request: Request):
    session = await get_session(request)
    if not session:
        raise HTTPException(status_code=403, detail="Session expired or invalid")

    user_email = session["email"]
    user_role = session["role"]

    body = await request.json()
    emp_no = body.get("emp_no")
    month = body.get("month")
    shift = body.get("shift", {})

    if not all([emp_no, month, shift]):
        raise HTTPException(status_code=400, detail="Missing required fields")

    if user_role != "superadmin":
        await auto_notify(request, user_email, f"assign/modify shift for {emp_no}")
        raise HTTPException(status_code=403, detail="Only superadmins can modify shifts")

    employee = await db["employees"].find_one({"emp_no": emp_no})
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")

    name = employee.get("name", "")
    shift_doc = {
        "emp_no": emp_no,
        "name": name,
        "month": month,
        "shift": shift,
        "updated_by": user_email,
        "updated_at": datetime.now(kolkata_tz).strftime("%d-%m-%Y %H:%M:%S")
    }

    shift_collection = db["shifts"]
    existing = await shift_collection.find_one({"emp_no": emp_no, "month": month})

    if existing:
        await shift_collection.replace_one({"_id": existing["_id"]}, shift_doc)
    else:
        await shift_collection.insert_one(shift_doc)

    return {"message": f"Shift updated for {name} ({emp_no}) for {month}."}


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
@app.post("/attendance")
async def mark_attendance(request: Request):
    session = await get_session(request)
    if not session:
        raise HTTPException(status_code=403, detail="Session expired or invalid")

    user_email = session["email"]
    user_name = session.get("name", user_email)
    role = session.get("role", "admin")

    body = await request.json()
    emp_no = body.get("emp_no")
    month = body.get("month")  # format: "YYYY-MM"
    attendance_data = body.get("attendance", {})

    if not all([emp_no, month, attendance_data]):
        raise HTTPException(status_code=400, detail="Missing required fields")

    # Validate month format
    try:
        year, month_num = map(int, month.split("-"))
    except:
        raise HTTPException(status_code=400, detail="Month format should be YYYY-MM")

    # Fetch employee info
    emp = await db["employees"].find_one({"emp_no": emp_no})
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    emp_name = emp.get("name", "")
    emp_type = emp.get("type", "").lower()
    if emp_type not in ["regular", "apprentice"]:
        raise HTTPException(status_code=400, detail="Invalid employee type")

    # Attendance validation window
    if emp_type == "regular":
        start_date = datetime(year, month_num, 11)
        end_date = datetime(year + 1, 1, 10) if month_num == 12 else datetime(year, month_num + 1, 10)
        valid_codes = REGULAR_ATTENDANCE_LEGEND.keys()
    else:
        start_date = datetime(year, month_num, 1)
        end_day = calendar.monthrange(year, month_num)[1]
        end_date = datetime(year, month_num, end_day)
        valid_codes = APPRENTICE_ATTENDANCE_LEGEND.keys()

    # Validate attendance entries
    for date_str, code in attendance_data.items():
        try:
            date_obj = datetime.strptime(date_str, "%d-%m-%Y")
            if not (start_date.date() <= date_obj.date() <= end_date.date()):
                raise HTTPException(status_code=400, detail=f"Date {date_str} is out of allowed range.")
        except:
            raise HTTPException(status_code=400, detail=f"Invalid date format: {date_str}. Must be DD-MM-YYYY")
        if not any(code.startswith(valid) for valid in valid_codes):
            raise HTTPException(status_code=400, detail=f"Invalid code '{code}' for type '{emp_type}'")

    attendance_collection = db["attendance"]
    existing = await attendance_collection.find_one({"emp_no": emp_no, "month": month})

    if existing and role != "superadmin":
        await auto_notify(request, user_email, f"modify attendance for {emp_no}")
        raise HTTPException(status_code=403, detail="Only superadmins can modify existing attendance")

    doc = {
        "emp_no": emp_no,
        "emp_name": emp_name,
        "type": emp_type,
        "month": month,
        "records": attendance_data,
        "updated_by": user_email,
        "updated_at": datetime.now(kolkata_tz).strftime("%d-%m-%Y %H:%M:%S")
    }

    if existing:
        await attendance_collection.replace_one({"_id": existing["_id"]}, doc)
        action = "updated"
    else:
        await attendance_collection.insert_one(doc)
        action = "created"

    summary = {}
    for status in attendance_data.values():
        key = status.split("/")[0] if "/" in status else status
        summary[key] = summary.get(key, 0) + 1

    return {
        "message": f"Attendance {action} for {emp_no} - {emp_name} for {month}.",
        "by": user_name,
        "status": action,
        "total_days": len(attendance_data),
        "summary": summary
    }

# Index creation for faster queries
@app.on_event("startup")
async def setup_indexes():
    """Create database indexes for faster queries"""
    await db["attendance"].create_index([("emp_no", 1), ("month", 1)], unique=True)
    await db["employees"].create_index("emp_no")
    await db["shifts"].create_index([("emp_no", 1), ("month", 1)])
    print("Database indexes created")


# Attendance legend for frontend access
@app.get("/attendance/legend")
async def get_attendance_legend():
    """
    Returns the legend of attendance codes for regular and apprentice employees
    """
    return {
        "regular": REGULAR_ATTENDANCE_LEGEND,
        "apprentice": APPRENTICE_ATTENDANCE_LEGEND,
        "message": "Attendance code legends for reference"
    }


# Retrieve attendance data
@app.get("/attendance")
async def get_attendance(request: Request, emp_no: str = None, month: str = None):
    session = await get_session(request)
    if not session:
        raise HTTPException(status_code=403, detail="Session expired. Please login again.")

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
            raise HTTPException(status_code=400, detail="Month should be in YYYY-MM format")
        filter_query["month"] = month

    cursor = db["attendance"].find(filter_query).sort("month", -1)
    attendance_records = []

    async for record in cursor:
        record.pop("_id", None)
        summary = {}
        for attendance_code in record.get("records", {}).values():
            code = attendance_code.split("/")[0] if "/" in attendance_code else attendance_code
            summary[code] = summary.get(code, 0) + 1
        record["summary"] = summary
        record["total_days"] = len(record.get("records", {}))
        attendance_records.append(record)

    return {
        "message": "Attendance records retrieved successfully" if attendance_records else "No attendance records found",
        "data": attendance_records,
        "count": len(attendance_records)
    }


# Simple endpoint to get attendance summary for one month
@app.get("/attendance/monthly")
async def get_monthly_summary(request: Request, month: str):
    session = await get_session(request)
    if not session:
        raise HTTPException(status_code=403, detail="Session expired")

    try:
        year, month_num = map(int, month.split("-"))
        if not (1 <= month_num <= 12):
            raise ValueError()
    except:
        raise HTTPException(status_code=400, detail="Month should be in YYYY-MM format")

    cursor = db["attendance"].find({"month": month}).sort("emp_no", 1)
    records = []
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

    return {
        "message": f"Monthly summary for {month}",
        "month": month,
        "employees": records,
        "total_employees": len(records)
    }


# Simple endpoint to get one employee's history@app.get("/attendance/employee/{emp_no}")
async def get_employee_history(request: Request, emp_no: str):
    session = await get_session(request)
    if not session:
        raise HTTPException(status_code=403, detail="Session expired")

    employee = await db["employees"].find_one({"emp_no": emp_no})
    if not employee:
        raise HTTPException(status_code=404, detail=f"Employee {emp_no} not found")

    cursor = db["attendance"].find({"emp_no": emp_no}).sort("month", -1)
    history = []
    async for record in cursor:
        record.pop("_id", None)
        summary = {}
        for code in record.get("records", {}).values():
            clean_code = code.split("/")[0] if "/" in code else code
            summary[clean_code] = summary.get(clean_code, 0) + 1
        record["summary"] = summary
        history.append(record)

    return {
        "message": f"Attendance history for {employee['name']} ({emp_no})",
        "employee": {
            "emp_no": emp_no,
            "name": employee["name"],
            "designation": employee["designation"],
            "type": employee["type"]
        },
        "history": history,
        "total_months": len(history)
    }


# Export attendance records@app.get("/export_regular")
async def export_regular(request: Request, month: str = "2025-07"):
    session = await get_session(request)
    if not session:
        raise HTTPException(status_code=403, detail="Session expired. Please login again.")

    stream = await create_attendance_excel(db, "regular", month)
    return StreamingResponse(
        stream,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=regular_attendance_{month}.xlsx"}
    )


@app.get("/export_apprentice")
async def export_apprentice(request: Request, month: str = "2025-07"):
    session = await get_session(request)
    if not session:
        raise HTTPException(status_code=403, detail="Session expired. Please login again.")

    stream = await create_attendance_excel(db, "apprentice", month)
    return StreamingResponse(
        stream,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=apprentice_attendance_{month}.xlsx"}
    )


@app.get("/me")
async def get_current_user(request: Request):
    """
    Returns the currently logged-in user's session data.
    """
    session = await get_session(request)
    if not session:
        raise HTTPException(status_code=401, detail="Not authenticated or session expired.")

    user = await db["users"].find_one({"email": session["email"]})
    if not user:
        raise HTTPException(status_code=404, detail="User not found in database.")

    user.pop("_id", None)
    return {"message": "User authenticated", "user": user}
