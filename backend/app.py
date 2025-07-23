from fastapi import FastAPI
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
import os

# Load environment variables
load_dotenv()

# Create FastAPI app instance
app = FastAPI()

# MongoDB connection
MONGO_URI = os.getenv("MONGO_URI")
client = AsyncIOMotorClient(MONGO_URI)
db = client["users"]

# Test home route
@app.get("/")
async def root():
    return {"message": "Attendify is active!"}
