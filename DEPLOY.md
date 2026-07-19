# Deploying SpaceATC (frontend + backend + OrbitMind, one container)

Everything ships as **one Docker image** on **Hugging Face Spaces** (free, 16 GB RAM,
WebSockets supported). FastAPI serves the API, the `/ws` WebSocket, the OrbitMind/Reflex
ML inference, **and** the built React UI — so judges open a single URL.

The repo is already deploy-ready: `Dockerfile`, `.dockerignore`, CPU-torch deps,
same-origin SPA serving, and Git LFS for the model weights are all set up.

## What I changed (already done, in the working tree)
- `Dockerfile` + `.dockerignore` — multi-stage build (Vite build → CPU-torch Python image)
- `backend/requirements.txt` — added `ultralytics`, `opencv-python-headless`, `python-multipart`
- `backend/main.py` — serves `frontend/dist` same-origin; CORS via `ALLOWED_ORIGINS` (default `*`)
- `frontend/src/hooks/useWebSocket.ts` — uses `wss://<same-host>/ws` in production
- `.gitattributes` + `.gitignore` — model weights (`*.pt`, `*.pth`, `output_h264.mp4`) tracked via Git LFS
- `README.md` — Hugging Face Space front-matter (`sdk: docker`, `app_port: 7860`)

## What you do (≈10 min)

### 1. One-time local setup
```bash
brew install git-lfs        # or: sudo apt-get install git-lfs
git lfs install
```

### 2. Create the Space
- Go to https://huggingface.co → **New → Space**
- **SDK: Docker**, name e.g. `spaceatc`, hardware **CPU basic** (free)
- In the Space → **Settings → Variables and secrets → New secret**:
  `GROQ_API_KEY = <your key>`

### 3. Commit the weights (via LFS) and push to the Space
From the repo root:
```bash
git add .gitattributes
git add "OrbitMind/best (1).pt" "OrbitMind/keypoint_mobilenet.pth" "OrbitMind/output_h264.mp4"
git add -A
git commit -m "Deploy: single-container Docker + LFS model weights"

git remote add space https://huggingface.co/spaces/<your-username>/spaceatc
git push space main
```
When prompted, use your HF **username** and an **access token** (HF → Settings →
Access Tokens → *write*) as the password.

### 4. Wait for the build
Hugging Face builds the Dockerfile (~10–15 min the first time — torch is large). When it
goes green, open `https://<your-username>-spaceatc.hf.space`.

## Notes
- **First Reflex frame is slow** (~a few seconds): the YOLO + keypoint models lazy-load on
  the first `/api/reflex/frame` call, then it's fast.
- **OrbitMind notebooks are NOT deployed** — they're training only (run on Colab/Kaggle).
  Only the trained weights ship, inside this container, used by `backend/api/reflex.py`.
- **SQLite + uploaded videos are ephemeral** on the Space (reset on rebuild). Fine for a
  demo — the backend re-ingests TLEs on every startup.
- **Faster inference:** upgrade the Space hardware to a paid CPU/GPU tier; nothing else changes.
- **Want a nicer URL / split deploy?** Put the frontend on Vercel and set
  `ALLOWED_ORIGINS=https://<your-vercel-domain>` on the Space, then point the frontend at the
  Space URL. Not required — the single container already serves the UI.

## Local sanity check before pushing
```bash
docker build -t spaceatc .
docker run -p 7860:7860 -e GROQ_API_KEY=<key> spaceatc
# open http://localhost:7860
```
