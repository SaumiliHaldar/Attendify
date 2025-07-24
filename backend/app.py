from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import RedirectResponse, JSONResponse
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
import os
import json 
import httpx
from datetime import datetime
from sessions import redis_set, redis_get
import pandas as pd
from fastapi import UploadFile, File

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
    role = request.query_params.get("role", "admin")  # default to "admin"

    # Handle OAuth errors (like access_denied)
    if error:
        if error == "access_denied":
            raise HTTPException(status_code=400, detail="User denied access to the application")
        else:
            raise HTTPException(status_code=400, detail=f"OAuth error: {error}")

    if not code:
        raise HTTPException(status_code=400, detail="Authorization code not found")

    if role not in ["admin", "superadmin"]:
        raise HTTPException(status_code=400, detail="Invalid role selected.")

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

    # Save/update user in MongoDB
    try:
        existing_user = await collection.find_one({"email": user_info["email"]})
        if not existing_user:
            await collection.insert_one(user_data)
        else:
            await collection.update_one(
                {"email": user_info["email"]},
                {"$set": {"role": role}}  # optionally update role
            )
    except Exception as e:
        print(f"MongoDB error: {e}")
        raise HTTPException(status_code=500, detail=f"DB error: {str(e)}")

    # Store user session in Redis (set expiry to 7 days = 604800 seconds)
    session_data = {
        "role": role,
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

# Load employees
@app.post("/employees")
async def load_employees():
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
                    "emp_no": str(row["Employee_No"]).strip(),
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
                "emp_no": str(row["Employee_No"]).strip(),
                "name": str(row["Name"]).strip(),
                "designation": str(row["Designation"]).strip(),
                "type": "apprentice"
            })
    except Exception as e:
        print(f"Error reading apprentice sheet: {e}")

    if not all_employees:
        raise HTTPException(status_code=400, detail="No employee data found.")

    emp_collection = db["employees"]
    await emp_collection.delete_many({})
    await emp_collection.insert_many(all_employees)

    return {"message": f"{len(all_employees)} employee details loaded."}

# Load holidays
# @app.post("/holidays")
# async def load_holidays():
#     HOLIDAY_SHEET = "ATTENDANCE SHEET MUSTER ROLL OF SSEE SW KGP.xlsx"
#     # Read the Excel sheet, using the second row (index 1) as header.
#     df = pd.read_excel(HOLIDAY_SHEET, sheet_name="HOLIDAYS", header=1) 
#     print("DEBUG - Holidays Columns:", df.columns.tolist())

#     holidays = []
#     # Filter out rows where 'Name of the Occasion' or 'Date' are NaN after parsing
#     df_filtered = df.dropna(subset=['Name of the Occasion', 'Date'])

#     for _, row in df_filtered.iterrows():
#         # Access by actual column names now
#         date_raw = row.get("Date")
#         name = row.get("Name of the Occasion")
        
#         if pd.notna(date_raw) and name:
#             try:
#                 # dayfirst=True handles DD.MM.YYYY format
#                 date = pd.to_datetime(str(date_raw).strip(), dayfirst=True, errors="coerce")
#                 if pd.notna(date):
#                     holidays.append({
#                         "date": date.strftime('%Y-%m-%d'),
#                         "name": str(name).strip()
#                     })
#             except Exception as e:
#                 # Log the error if a date conversion fails for a row
#                 print(f"Error processing holiday row: {row.to_dict()} - {e}")
#                 continue

#     if not holidays:
#         raise HTTPException(status_code=400, detail="No holidays found in the Excel sheet")

#     hol_collection = db["holidays"]
#     await hol_collection.delete_many({})
#     await hol_collection.insert_many(holidays)
#     return {"message": f"{len(holidays)} holidays inserted."}


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