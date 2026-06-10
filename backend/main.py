from fastapi import FastAPI
from backend.config import settings

app = FastAPI(title="SpaceATC")

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "demo_mode": settings.demo_mode
    }
