import os
import httpx
import json
from dotenv import load_dotenv

load_dotenv()

UPSTASH_REDIS_REST_URL = os.getenv("UPSTASH_REDIS_REST_URL")
UPSTASH_REDIS_REST_TOKEN = os.getenv("UPSTASH_REDIS_REST_TOKEN")

headers = {
    "Authorization": f"Bearer {UPSTASH_REDIS_REST_TOKEN}",
    "Content-Type": "application/json"
}

async def redis_set(key: str, value: str, expiry: int = 3600):
    """
    Set a key-value pair in Redis with expiry.
    The value should already be a JSON string when passed to this function.
    """
    try:
        # For Upstash Redis REST API, the command format should be:
        # ["SET", key, value, "EX", expiry_seconds]
        payload = ["SET", key, value, "EX", str(expiry)]
        
        print(f"DEBUG: Redis SET payload being sent: {json.dumps(payload)}")

        async with httpx.AsyncClient() as client:
            response = await client.post(
                UPSTASH_REDIS_REST_URL, 
                json=payload,  # Send the array directly, not wrapped in {"command": ...}
                headers=headers
            )
            response.raise_for_status()
            result = response.json()
            print(f"DEBUG: Redis SET response: {result}")
            return result
    except httpx.HTTPStatusError as e:
        print(f"ERROR: HTTPStatusError during Redis SET: {e}")
        print(f"ERROR: Response status: {e.response.status_code}")
        print(f"ERROR: Response text: {e.response.text}")
        raise
    except Exception as e:
        print(f"ERROR: Unexpected error during Redis SET: {e}")
        raise

async def redis_get(key: str):
    """
    Get a value from Redis by key.
    """
    try:
        payload = ["GET", key]
        
        print(f"DEBUG: Redis GET payload being sent: {json.dumps(payload)}")
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                UPSTASH_REDIS_REST_URL, 
                json=payload, 
                headers=headers
            )
            response.raise_for_status()
            result = response.json()
            print(f"DEBUG: Redis GET response: {result}")
            return result  # Return the actual result, not wrapped in .get("result")
    except httpx.HTTPStatusError as e:
        print(f"ERROR: HTTPStatusError during Redis GET: {e}")
        print(f"ERROR: Response status: {e.response.status_code}")
        print(f"ERROR: Response text: {e.response.text}")
        raise
    except Exception as e:
        print(f"ERROR: Unexpected error during Redis GET: {e}")
        raise

async def redis_delete(key: str):
    """
    Delete a key from Redis.
    """
    try:
        payload = ["DEL", key]
        
        print(f"DEBUG: Redis DEL payload being sent: {json.dumps(payload)}")
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                UPSTASH_REDIS_REST_URL, 
                json=payload, 
                headers=headers
            )
            response.raise_for_status()
            result = response.json()
            print(f"DEBUG: Redis DEL response: {result}")
            return result
    except httpx.HTTPStatusError as e:
        print(f"ERROR: HTTPStatusError during Redis DEL: {e}")
        print(f"ERROR: Response status: {e.response.status_code}")
        print(f"ERROR: Response text: {e.response.text}")
        raise
    except Exception as e:
        print(f"ERROR: Unexpected error during Redis DEL: {e}")
        raise