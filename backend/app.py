from fastapi import FastAPI, Request, HTTPException, APIRouter
from fastapi.responses import RedirectResponse, JSONResponse
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
import os
import json 
import httpx
from datetime import datetime
from sessions import redis_set, redis_get, redis_delete
import pandas as pd
from fastapi import UploadFile, File, Header
from datetime import datetime, timedelta
from typing import Dict
import calendar


# Load environment variables
load_dotenv()

app = FastAPI()

# MongoDB setup
MONGO_URI = os.getenv("MONGO_URI")
client = AsyncIOMotorClient(MONGO_URI, tls=True)
db = client["Attendify"]
collection = db["users"]

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET")
REDIRECT_URI = os.getenv("REDIRECT_URI")

# Employee sheet
EMPLOYEE_SHEET = "./ATTENDANCE SHEET MUSTER ROLL OF SSEE SW KGP.xlsx"

# Routes
@app.get("/")
async def root():
    return {"message": "Attendify is active!"}


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


    # Handle OAuth errors (like access_denied)
    if error:
        if error == "access_denied":
            raise HTTPException(status_code=400, detail="User denied access to the application")
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
        print(f"Token request error: {e}")
        raise HTTPException(status_code=500, detail=f"Token request failed: {str(e)}")

    access_token = token_json.get("access_token")
    if not access_token:
        print(f"Token response missing access_token: {token_json}")
        raise HTTPException(status_code=500, detail=f"Access token missing: {token_json}")

    # Get user info
    try:
        async with httpx.AsyncClient() as client:
            userinfo_response = await client.get(
                "https://www.googleapis.com/oauth2/v2/userinfo",
                headers={"Authorization": f"Bearer {access_token}"}
            )
            userinfo_response.raise_for_status()
            user_info = userinfo_response.json()
            
            # Define trusted superadmins
            SUPERADMINS = ["haldar.saumili843@gmail.com", "haldar.sk2006@gmail.com"]
            user_email = user_info["email"]
            role = "superadmin" if user_email in SUPERADMINS else "admin"
    except httpx.HTTPError as e:
        print(f"Userinfo request error: {e}")
        raise HTTPException(status_code=500, detail=f"Userinfo request failed: {str(e)}")

    # Create user data
    user_data = {
        "email": user_info["email"],
        "is_verified": user_info.get("verified_email", False),
        "name": user_info.get("name", ""),
        "role": role,
        "created_at": datetime.utcnow().isoformat()
    }

    # Save user details in MongoDB
    try:
        existing_user = await collection.find_one({"email": user_info["email"]})
        if not existing_user:
            await collection.insert_one(user_data)
        else:
            print(f"User already exists: {user_info['email']} — skipping update")
    except Exception as e:
        print(f"MongoDB error: {e}")
        raise HTTPException(status_code=500, detail=f"DB error: {str(e)}")

    # Store user session in Redis (set expiry to 7 days = 604800 seconds)
    session_data = {
        "email": user_info["email"],
        "name": user_info.get("name", ""),
        "is_verified": user_info.get("verified_email", False)
    }
    
    try:
        # Convert session data to JSON string
        session_json = json.dumps(session_data)
        print(f"DEBUG: Storing session data for {user_info['email']}: {session_json}")
        
        # Store in Redis with 7 days expiry (7 * 24 * 60 * 60 = 604800 seconds)
        await redis_set(user_info["email"], session_json, expiry=604800)
        print(f"DEBUG: Successfully stored session in Redis for {user_info['email']}")
        
    except Exception as e:
        print(f"Redis error details: {e}")
        # Don't fail the entire request if Redis fails, just log it
        print(f"WARNING: Failed to store session in Redis, but continuing with authentication")

    return JSONResponse(content={key: value for key, value in user_data.items() if key != "_id"})


# Logout and session cleared
@app.post("/logout")
async def logout(request: Request):
    try:
        body = await request.json()
        email = body.get("email")

        if not email:
            raise HTTPException(status_code=400, detail="Email is required for logout")

        await redis_delete(email)

        return JSONResponse(content={"message": f"User {email} logged out successfully."})
    
    except Exception as e:
        print(f"Logout error: {e}")
        raise HTTPException(status_code=500, detail="Logout failed")

# Load employees
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

        # Helper function to clean employee number
        def clean_emp_no(emp_no):
            """Remove .0 from employee numbers and clean whitespace"""
            emp_str = str(emp_no).strip()
            # Remove .0 if it exists at the end
            if emp_str.endswith('.0'):
                emp_str = emp_str[:-2]
            return emp_str

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
                        "emp_no": clean_emp_no(row["Employee_No"]),  # Fixed: clean the employee number
                        "name": str(row["Name"]).strip(),
                        "designation": str(row["Designation"]).strip(),
                        "type": "regular"
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
                    "emp_no": clean_emp_no(row["Employee_No"]),  # Fixed: clean the employee number
                    "name": str(row["Name"]).strip(),
                    "designation": str(row["Designation"]).strip(),
                    "type": "apprentice"
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


# Shift management
@app.post("/shift")
async def assign_shift(request: Request, authorization: str = Header(None)):
    body = await request.json()

    emp_no = body.get("emp_no")
    month = body.get("month")  # "YYYY-MM"
    shift = body.get("shift", {})

    if not all([emp_no, month, shift]):
        raise HTTPException(status_code=400, detail="Missing required fields")

    # Get user session from header
    if not authorization:
        raise HTTPException(status_code=403, detail="Authorization header missing")

    user_email = authorization  # can be a token or just email, based on how frontend is set
    session = await redis_get(user_email)
    if not session:
        raise HTTPException(status_code=403, detail="Session expired or invalid")

    # Fix: Handle the Redis response format
    if isinstance(session, dict) and 'result' in session:
        session_data = json.loads(session['result'])
    elif isinstance(session, str):
        session_data = json.loads(session)
    else:
        raise HTTPException(status_code=403, detail="Invalid session format")

    submitted_by = session_data.get("email")

    # Get employee name
    employee = await db["employees"].find_one({"emp_no": emp_no})
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")

    name = employee.get("name", "")

    # Build shift document
    shift_doc = {
        "emp_no": emp_no,
        "name": name,
        "month": month,
        "shift": shift,
        "updated_by": submitted_by,
        "updated_at": datetime.utcnow().isoformat()
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

@attendance.post("/attendance")
async def mark_attendance(request: Request, authorization: str = Header(None)):
    body = await request.json()

    emp_no = body.get("emp_no")
    month = body.get("month")  # format: "YYYY-MM"
    attendance = body.get("attendance", {})

    if not authorization:
        raise HTTPException(status_code=403, detail="Authorization header missing")
    
    if not all([emp_no, month, attendance]):
        raise HTTPException(status_code=400, detail="Missing required fields")

    # Validate month format
    try:
        year, month_num = map(int, month.split("-"))
    except:
        raise HTTPException(status_code=400, detail="Month format should be YYYY-MM")

    # Get session from Redis
    session = await redis_get(authorization)
    if not session:
        raise HTTPException(status_code=403, detail="Session expired or invalid")

    # Parse session
    if isinstance(session, dict) and 'result' in session:
        user_data = json.loads(session['result'])
    elif isinstance(session, str):
        user_data = json.loads(session)
    else:
        raise HTTPException(status_code=403, detail="Invalid session format")

    updated_by = user_data.get("email")
    updated_by_name = user_data.get("name", updated_by)
    role = user_data.get("role", "admin")

    # Fetch employee from DB
    emp = await db["employees"].find_one({"emp_no": emp_no})
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    emp_name = emp.get("name", "")
    emp_type = emp.get("type", "").lower()

    if emp_type not in ["regular", "apprentice"]:
        raise HTTPException(status_code=400, detail="Invalid employee type in DB")

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
    for date_str, code in attendance.items():
        try:
            date_obj = datetime.strptime(date_str, "%Y-%m-%d")
            if not (start_date <= date_obj <= end_date):
                raise HTTPException(status_code=400, detail=f"Date {date_str} is out of allowed range.")
        except:
            raise HTTPException(status_code=400, detail=f"Invalid date format: {date_str}")

        if not any(code.startswith(valid) for valid in valid_codes):
            raise HTTPException(status_code=400, detail=f"Invalid attendance code '{code}' for type '{emp_type}'")

    # Attendance collection
    attendance_collection = db["attendance"]
    existing = await attendance_collection.find_one({"emp_no": emp_no, "month": month})

    if existing and role != "superadmin":
        raise HTTPException(status_code=403, detail="Only superadmin can modify existing attendance")

    doc = {
        "emp_no": emp_no,
        "emp_name": emp_name,
        "type": emp_type,
        "month": month,
        "records": attendance,
        "updated_by": updated_by,
        "updated_at": datetime.utcnow().isoformat()
    }

    if existing:
        await attendance_collection.replace_one({"_id": existing["_id"]}, doc)
        action = "updated"
    else:
        await attendance_collection.insert_one(doc)
        action = "created"

    summary = {}
    for status in attendance.values():
        key = status.split("/")[0] if "/" in status else status
        summary[key] = summary.get(key, 0) + 1

    return {
        "message": f"Attendance {action} for {emp_no} - {emp_name} for {month}.",
        "by": updated_by_name,
        "status": action,
        "total_days": len(attendance),
        "summary": summary
    }

app.include_router(attendance)
# Index creation for faster queries
@app.on_event("startup")
async def setup_indexes():
    # await db["attendance"].create_index([("emp_no", 1), ("month", 1)])
    await db["attendance"].create_index([("emp_no", 1), ("month", 1)], unique=True)
    await db["employees"].create_index("emp_no")
    await db["shifts"].create_index([("emp_no", 1), ("month", 1)])
    print("Indexes created")



# Retrival of attendance data
@attendance.get("/attendance")
async def get_attendance(emp_no: str = None, month: str = None, authorization: str = Header(None)):
    if not authorization:
        raise HTTPException(status_code=403, detail="Authorization header missing")

    # Validate month
    if not month:
        raise HTTPException(status_code=400, detail="Query parameter 'month' is required")
    
    try:
        datetime.strptime(month, "%Y-%m")
    except:
        raise HTTPException(status_code=400, detail="Month must be in YYYY-MM format")

    # Redis session check
    session = await redis_get(authorization)
    if not session:
        raise HTTPException(status_code=403, detail="Session expired or invalid")

    if isinstance(session, dict) and 'result' in session:
        user_data = json.loads(session['result'])
    elif isinstance(session, str):
        user_data = json.loads(session)
    else:
        raise HTTPException(status_code=403, detail="Invalid session format")

    role = user_data.get("role", "admin")

    query = {"month": month}
    if emp_no:
        query["emp_no"] = emp_no

    records_cursor = db["attendance"].find(query)
    results = []
    async for doc in records_cursor:
        doc["_id"] = str(doc["_id"])
        results.append(doc)

    if not results:
        raise HTTPException(status_code=404, detail="No attendance records found")

    return {"count": len(results), "data": results}
