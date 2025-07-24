from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import RedirectResponse, JSONResponse
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
import os
import httpx
from datetime import datetime

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
    role = request.query_params.get("role", "admin")  # default to "admin"

    if role not in ["admin", "superadmin"]:
        raise HTTPException(status_code=400, detail="Invalid role selected.")

    if not code:
        raise HTTPException(status_code=400, detail="Authorization code not found")

    # Exchange code for access token
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
        raise HTTPException(status_code=500, detail=f"Token request failed: {str(e)}")

    access_token = token_json.get("access_token")
    if not access_token:
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
        raise HTTPException(status_code=500, detail=f"Userinfo request failed: {str(e)}")

    # Create user data
    user_data = {
        "email": user_info["email"],
        "is_verified": user_info.get("verified_email", False),
        "name": user_info.get("name", ""),
        "role": role,
        "created_at": datetime.utcnow().isoformat()
    }

    # Store or update user in DB
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
        raise HTTPException(status_code=500, detail=f"DB error: {str(e)}")

    # return JSONResponse(content=user_data)
    return JSONResponse(content={key: value for key, value in user_data.items() if key != "_id"})

