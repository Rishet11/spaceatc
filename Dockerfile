# ---- Stage 1: build the frontend (Vite SPA) ----
FROM node:20-slim AS frontend
WORKDIR /fe
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build          # -> /fe/dist

# ---- Stage 2: Python backend + ML + serve the built SPA ----
FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=7860

# System libs OpenCV/ffmpeg need at runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# CPU-only torch/torchvision first (keeps the image ~2GB instead of pulling CUDA)
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# App code, ML weights, and the built SPA
COPY backend/ ./backend/
COPY OrbitMind/ ./OrbitMind/
COPY --from=frontend /fe/dist ./frontend/dist

EXPOSE 7860
CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-7860}"]
