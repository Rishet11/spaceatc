"""
backend/api/reflex.py — REST API router for OrbitMind Reflex Layer
"""

import os
import sys
import shutil
import base64
import json
import logging
import asyncio
import threading
from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel
import cv2
import numpy as np
import torch
import torch.nn as nn
from torchvision import models, transforms
from ultralytics import YOLO

from backend.api.reflex_playbook import (
    classify_threat,
    reflex_decision,
    reset_decision_cache,
    swept_range,
)

logger = logging.getLogger(__name__)
router = APIRouter()

# Paths
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
ORBITMIND_DIR = os.path.join(BASE_DIR, "OrbitMind")
UPLOAD_DIR = os.path.join(ORBITMIND_DIR, "uploads")

VIDEO_PATH = os.path.join(ORBITMIND_DIR, "output_h264.mp4")
CURRENT_VIDEO_PATH = VIDEO_PATH
YOLO_WEIGHTS = os.path.join(ORBITMIND_DIR, "best (1).pt")
KPT_WEIGHTS = os.path.join(ORBITMIND_DIR, "keypoint_mobilenet.pth")
CAMERA_JSON = os.path.join(ORBITMIND_DIR, "camera.json")
TANGO_MAT = os.path.join(ORBITMIND_DIR, "tangoPoints.mat")

# Config
CFG = {
    "crop_size": 224,
    "num_keypoints": 11,
    "yolo_conf": 0.10,
    "yolo_iou": 0.45,
    "bbox_margin": 0.07,
    "device": "cpu"
}
NUM_COORDS = CFG["num_keypoints"] * 2
EDGES = [
    (0,1), (1,2), (2,3), (3,0),   # face 1
    (4,5), (5,6), (6,7), (7,4),   # face 2
    (0,4), (1,5), (2,6), (3,7)    # connecting edges
]
FALLBACK_KP3D = np.array([
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
    [0, 0, -1.5], [0, 0, 1.5], [1.5, 0, 0]
], dtype=np.float32)

# Global model cache to make requests fast
YOLO_MODEL = None
KPT_MODEL = None
K = None
DIST_COEFFS = None
KP3D = None

class KeypointMobileNet(nn.Module):
    def __init__(self, num_coords=22):
        super().__init__()
        base = models.mobilenet_v3_small(weights=None)
        feat_dim = base.classifier[0].in_features
        base.classifier = nn.Identity()
        self.backbone = base
        self.head = nn.Sequential(
            nn.Linear(feat_dim, 256),
            nn.Hardswish(),
            nn.Dropout(0.3),
            nn.Linear(256, 128),
            nn.Hardswish(),
            nn.Dropout(0.2),
            nn.Linear(128, num_coords),
            nn.Sigmoid()
        )

    def forward(self, x):
        return self.head(self.backbone(x))

_MEAN = [0.485, 0.456, 0.406]
_STD  = [0.229, 0.224, 0.225]
TRANSFORM = transforms.Compose([
    transforms.ToPILImage(),
    transforms.Resize((CFG["crop_size"], CFG["crop_size"])),
    transforms.ToTensor(),
    transforms.Normalize(_MEAN, _STD)
])

def lazy_load_models():
    global YOLO_MODEL, KPT_MODEL, K, DIST_COEFFS, KP3D
    device = CFG["device"]
    
    if YOLO_MODEL is None:
        logger.info("Lazy loading YOLO26 model for Reflex API...")
        YOLO_MODEL = YOLO(YOLO_WEIGHTS)
        
    if KPT_MODEL is None:
        logger.info("Lazy loading KeypointMobileNet model for Reflex API...")
        ckpt = torch.load(KPT_WEIGHTS, map_location=device, weights_only=False)
        KPT_MODEL = KeypointMobileNet(NUM_COORDS)
        state_dict = ckpt["state_dict"] if "state_dict" in ckpt else ckpt
        KPT_MODEL.load_state_dict(state_dict)
        KPT_MODEL.to(device)
        KPT_MODEL.eval()
        
    if K is None:
        if os.path.exists(CAMERA_JSON):
            with open(CAMERA_JSON) as f:
                cam = json.load(f)
            K = np.array(cam["cameraMatrix"], dtype=np.float32)
            DIST_COEFFS = np.array(cam["distCoeffs"], dtype=np.float32).ravel()
        else:
            K = np.array([[1000, 0, 960], [0, 1000, 600], [0, 0, 1]], dtype=np.float32)
            DIST_COEFFS = np.zeros(5, dtype=np.float32)

    if KP3D is None:
        if os.path.exists(TANGO_MAT):
            from scipy.io import loadmat
            KP3D = np.ascontiguousarray(loadmat(TANGO_MAT)["tango3Dpoints"].T).astype(np.float32)
        else:
            KP3D = FALLBACK_KP3D

def rotation_matrix_to_quaternion(R):
    q = np.empty(4)
    trace = np.trace(R)
    if trace > 0:
        s = np.sqrt(trace + 1.0) * 2
        q[0] = 0.25 * s
        q[1] = (R[2,1] - R[1,2]) / s
        q[2] = (R[0,2] - R[2,0]) / s
        q[3] = (R[1,0] - R[0,1]) / s
    else:
        if R[0,0] > R[1,1] and R[0,0] > R[2,2]:
            s = np.sqrt(1.0 + R[0,0] - R[1,1] - R[2,2]) * 2
            q[0] = (R[2,1]-R[1,2]) / s
            q[1] = 0.25 * s
            q[2] = (R[0,1]+R[1,0]) / s
            q[3] = (R[0,2]+R[2,0]) / s
        elif R[1,1] > R[2,2]:
            s = np.sqrt(1.0 + R[1,1] - R[0,0] - R[2,2]) * 2
            q[0] = (R[0,2]-R[2,0]) / s
            q[1] = (R[0,1]+R[1,0]) / s
            q[2] = 0.25 * s
            q[3] = (R[1,2]+R[2,1]) / s
        else:
            s = np.sqrt(1.0 + R[2,2] - R[0,0] - R[1,1]) * 2
            q[0] = (R[1,0]-R[0,1]) / s
            q[1] = (R[0,2]+R[2,0]) / s
            q[2] = (R[1,2]+R[2,1]) / s
            q[3] = 0.25 * s
    return q

def estimate_pose(kpts_2d, kp3d, camera_matrix, dist_coeffs):
    success, rvec, tvec = cv2.solvePnP(
        np.ascontiguousarray(kp3d, dtype=np.float32),
        np.ascontiguousarray(kpts_2d, dtype=np.float32),
        np.ascontiguousarray(camera_matrix, dtype=np.float32),
        np.ascontiguousarray(dist_coeffs, dtype=np.float32),
        flags=cv2.SOLVEPNP_EPNP
    )
    if not success:
        return None
    R, _ = cv2.Rodrigues(rvec)
    quat = rotation_matrix_to_quaternion(R)
    return quat, tvec

# ---------------------------------------------------------------------------
# Asset guards + frame cache
# ---------------------------------------------------------------------------
# Real weights/video are MB-scale; an unresolved Git LFS pointer is ~130 bytes.
LFS_STUB_MAX_BYTES = 1024


def _missing_or_stub(path: str) -> bool:
    """True if a required binary is absent or an unresolved Git LFS pointer."""
    return (not os.path.exists(path)) or os.path.getsize(path) < LFS_STUB_MAX_BYTES


def _require_inference_assets():
    """Raise a clear 503 if the model weights aren't really deployed (LFS stubs)."""
    missing = []
    if _missing_or_stub(YOLO_WEIGHTS):
        missing.append("YOLO26 weights (best (1).pt)")
    if _missing_or_stub(KPT_WEIGHTS):
        missing.append("keypoint weights (keypoint_mobilenet.pth)")
    if missing:
        raise HTTPException(
            status_code=503,
            detail=(
                "OrbitMind inference assets are unavailable on this deployment: "
                + ", ".join(missing)
                + ". These are Git LFS files — deploy them as real binaries, not LFS pointers."
            ),
        )


def _require_video(path: str):
    """Raise a clear 503 if the active video is missing or an LFS stub."""
    if _missing_or_stub(path):
        raise HTTPException(
            status_code=503,
            detail=(
                "The video feed is unavailable (missing or an unresolved Git LFS pointer). "
                "Upload a video, or ensure the default clip is deployed as a real binary."
            ),
        )


# Cache of fully-computed frame responses keyed by (video_path, frame_idx, mode)
# so scrubbing/replaying a frame is instant instead of re-running YOLO26 + pose
# on CPU. Cleared whenever the active video changes (upload / reset).
_FRAME_CACHE: dict[tuple[str, int, str], dict] = {}

# Serialize model inference: the prewarm task and on-demand frame requests must
# not run the shared YOLO/keypoint models concurrently (PyTorch modules are not
# re-entrant). The cache check happens *before* this lock, so cached frames stay
# instant.
_INFER_LOCK = threading.Lock()

# Per-video frame count, cached so the replay range sweep and prewarm don't
# reopen the container on every frame.
_TOTAL_CACHE: dict[str, int] = {}

# Background prewarm progress, keyed by (video_path, mode): {ready, total, done}.
_PREWARM: dict[tuple[str, str], dict] = {}


def _clear_frame_cache():
    _FRAME_CACHE.clear()
    _TOTAL_CACHE.clear()
    _PREWARM.clear()


def _open_capture(path: str):
    """Open a video with the FFmpeg backend, falling back to the default."""
    cap = cv2.VideoCapture(path, cv2.CAP_FFMPEG)
    if not cap.isOpened():
        cap.release()
        cap = cv2.VideoCapture(path)
    return cap


def _total_frames_cached(path: str) -> int:
    total = _TOTAL_CACHE.get(path)
    if total is not None:
        return total
    cap = _open_capture(path)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) if cap.isOpened() else 0
    cap.release()
    _TOTAL_CACHE[path] = total
    return total


# Decision-Loop Replay: in replay mode the relative range is an explicitly-
# labeled *swept input* (not a CV measurement) produced by reflex_playbook.
# swept_range(), so the agent walks every threat band — scan -> monitor ->
# prime -> evade — and the full decision policy + validated thruster command are
# demonstrable on the benchmark imagery. Detection (YOLO box + 6DOF keypoints)
# and the decision logic stay live; only the range is swept, and the UI labels
# it loudly so it is never mistaken for a measured close approach.


@router.get("/api/reflex/total_frames")
async def get_total_frames():
    """Returns the total number of frames in the active video."""
    _require_video(CURRENT_VIDEO_PATH)
    total = _total_frames_cached(CURRENT_VIDEO_PATH)
    if total <= 0:
        raise HTTPException(status_code=500, detail="Failed to open video file")
    return {"total_frames": total}


def _infer_frame_blocking(frame_idx: int, mode: str | None) -> dict:
    """Blocking CV + pose inference for one frame (run via asyncio.to_thread).

    Returns everything except the LLM decision narrative, which the async caller
    adds. Range is swept (not measured) when mode == 'replay'.
    """
    with _INFER_LOCK:
        cap = _open_capture(CURRENT_VIDEO_PATH)
        if not cap.isOpened():
            raise HTTPException(status_code=500, detail="Failed to open video file")
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ret, frame = cap.read()
        cap.release()
        if not ret:
            raise HTTPException(status_code=400, detail=f"Could not read frame {frame_idx}")

        img_h, img_w = frame.shape[:2]

        # Run YOLO prediction
        results = YOLO_MODEL(frame, conf=CFG["yolo_conf"], iou=CFG["yolo_iou"], verbose=False)

        # Defaults
        box_coords = None
        kpts_list = None
        quat = [1.0, 0.0, 0.0, 0.0]
        tvec_coords = [0.0, 0.0, 5.0]
        detected = False

        out_frame = frame.copy()

        for result in results:
            boxes = result.boxes
            if len(boxes) == 0:
                continue

            box = boxes[0].xyxy[0].cpu().numpy()
            x1, y1, x2, y2 = box
            box_coords = [float(x1), float(y1), float(x2), float(y2)]
            detected = True

            # Add margin
            bw, bh = x2 - x1, y2 - y1
            mx, my = bw * CFG["bbox_margin"], bh * CFG["bbox_margin"]
            cx1, cy1 = max(0, int(x1 - mx)), max(0, int(y1 - my))
            cx2, cy2 = min(img_w, int(x2 + mx)), min(img_h, int(y2 + my))

            crop = frame[cy1:cy2, cx1:cx2]
            if crop.size == 0:
                continue

            # Keypoint prediction
            inp = TRANSFORM(crop).unsqueeze(0).to(CFG["device"])
            with torch.no_grad():
                pred = KPT_MODEL(inp)[0].cpu().numpy()

            # Scale keypoints back to frame space
            cbw, cbh = cx2 - cx1, cy2 - cy1
            kpts = np.stack([pred[0::2] * cbw + cx1, pred[1::2] * cbh + cy1], axis=-1)
            kpts_list = kpts.tolist()

            # Pose Estimation
            pose = estimate_pose(kpts, KP3D, K, DIST_COEFFS)
            if pose is not None:
                quat_val, tvec_val = pose
                quat = [float(q) for q in quat_val]
                tvec_coords = [float(t[0]) for t in tvec_val]

            # Drawing: Bounding Box
            cv2.rectangle(out_frame, (int(x1), int(y1)), (int(x2), int(y2)), (0, 255, 0), 2)

            # Drawing: Connect wireframe edges
            for s, e in EDGES:
                if s < len(kpts) and e < len(kpts):
                    cv2.line(out_frame, (int(kpts[s, 0]), int(kpts[s, 1])), (int(kpts[e, 0]), int(kpts[e, 1])), (0, 255, 255), 2)

            # Drawing: Keypoints
            for i, (px, py) in enumerate(kpts):
                cv2.circle(out_frame, (int(px), int(py)), 5, (0, 0, 255), -1)
                cv2.putText(out_frame, str(i), (int(px) + 4, int(py) - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 255, 255), 1)

        # Encode frame to Base64
        _, jpeg_buffer = cv2.imencode('.jpg', out_frame)
        img_b64 = base64.b64encode(jpeg_buffer).decode('utf-8')

        # Distance to debris (measured), or a swept demonstration input in replay.
        distance = float(np.linalg.norm(tvec_coords))
        swept = mode == "replay"
        if swept:
            total = _total_frames_cached(CURRENT_VIDEO_PATH) or 1
            distance = swept_range(frame_idx, total)
            # Keep real X/Y; substitute the swept range on Z so the HUD agrees.
            tvec_coords = [tvec_coords[0], tvec_coords[1], distance]

        # Threat classification stays deterministic (safety reflex).
        status, threat_level = classify_threat(detected, distance)
        return {
            "image": img_b64,
            "box": box_coords,
            "keypoints": kpts_list,
            "detected": detected,
            "distance": distance,
            "tvec": tvec_coords,
            "quat": quat,
            "status": status,
            "threat_level": threat_level,
            "swept_range": swept,
        }


async def _compute_frame(frame_idx: int, mode: str | None) -> dict:
    """Cache-or-compute a fully decorated frame response (CV + agent decision).

    The heavy CV/pose inference runs in a worker thread so the event loop stays
    responsive (and so a background prewarm doesn't block interactive requests);
    the agent reasoning is generated by retrieval + an LLM with a deterministic
    guardrail and rule-based fallback (see reflex_playbook), cached per band.
    """
    cache_key = (CURRENT_VIDEO_PATH, frame_idx, mode or "live")
    cached = _FRAME_CACHE.get(cache_key)
    if cached is not None:
        return cached

    _require_video(CURRENT_VIDEO_PATH)
    _require_inference_assets()
    lazy_load_models()

    partial = await asyncio.to_thread(_infer_frame_blocking, frame_idx, mode)

    decision_log, dodge_command = await reflex_decision(
        partial["status"], partial["threat_level"], partial["detected"],
        partial["distance"], partial["tvec"], partial["quat"],
    )
    if partial["swept_range"]:
        decision_log = (
            "[REPLAY] Relative range is a swept demonstration input — "
            "detection & decision logic are live.\n" + decision_log
        )

    response = {
        "image": partial["image"],
        "box": partial["box"],
        "keypoints": partial["keypoints"],
        "pose": {
            "translation": partial["tvec"],
            "quaternion": partial["quat"],
            "distance": partial["distance"],
        },
        "status": partial["status"],
        "threat_level": partial["threat_level"],
        "decision_log": decision_log,
        "dodge_command": dodge_command,
        "mode": mode or "live",
        "swept_range": partial["swept_range"],
    }
    _FRAME_CACHE[cache_key] = response
    return response


@router.get("/api/reflex/frame/{frame_idx}")
async def get_frame(frame_idx: int, mode: str | None = None):
    """Run detection + pose + the onboard agent decision for one frame.

    ``mode='replay'`` sweeps the relative range across the threat bands to
    demonstrate the full autonomous decision policy (detection stays live; the
    range is an explicitly-labeled swept input). Results are memoized per
    (video, frame, mode).
    """
    return await _compute_frame(frame_idx, mode)


async def _prewarm_worker(video_path: str, mode: str | None, total: int):
    """Compute every frame of (video_path, mode) into the cache, sequentially."""
    key = (video_path, mode or "live")
    try:
        for i in range(total):
            # Stop if the active video was swapped out from under us.
            if CURRENT_VIDEO_PATH != video_path:
                break
            try:
                await _compute_frame(i, mode)
            except Exception as e:  # noqa: BLE001 — one bad frame must not kill prewarm
                logger.warning("Prewarm frame %d failed: %s", i, e)
            st = _PREWARM.get(key)
            if st is None:
                break
            st["ready"] = i + 1
    finally:
        st = _PREWARM.get(key)
        if st is not None:
            st["done"] = True


@router.post("/api/reflex/prewarm")
async def prewarm(mode: str | None = None):
    """Background-compute every frame of the active (video, mode) into the cache
    so playback is smooth instead of running inference live per frame."""
    if _missing_or_stub(CURRENT_VIDEO_PATH) or _missing_or_stub(YOLO_WEIGHTS) or _missing_or_stub(KPT_WEIGHTS):
        return {"status": "unavailable", "ready": 0, "total": 0}

    total = _total_frames_cached(CURRENT_VIDEO_PATH)
    key = (CURRENT_VIDEO_PATH, mode or "live")
    existing = _PREWARM.get(key)
    if existing and not existing.get("done"):
        return {"status": "running", "ready": existing["ready"], "total": existing["total"]}

    _PREWARM[key] = {"ready": 0, "total": total, "done": total == 0}
    if total > 0:
        asyncio.create_task(_prewarm_worker(CURRENT_VIDEO_PATH, mode, total))
    return {"status": "started", "ready": 0, "total": total}


@router.get("/api/reflex/prewarm_status")
async def prewarm_status(mode: str | None = None):
    """Progress of the background prewarm for the active (video, mode)."""
    key = (CURRENT_VIDEO_PATH, mode or "live")
    st = _PREWARM.get(key)
    if st is None:
        return {"ready": 0, "total": _total_frames_cached(CURRENT_VIDEO_PATH), "done": False}
    return {"ready": st["ready"], "total": st["total"], "done": st.get("done", False)}

@router.post("/api/reflex/upload")
async def upload_video(file: UploadFile = File(...)):
    global CURRENT_VIDEO_PATH
    
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in [".mp4", ".avi", ".mov", ".mkv", ".webm"]:
        raise HTTPException(status_code=400, detail="Unsupported video format. Please upload MP4, AVI, MOV, MKV, or WEBM.")
        
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    target_path = os.path.join(UPLOAD_DIR, f"uploaded_video{ext}")
    
    try:
        await file.seek(0)
        with open(target_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
    except Exception as e:
        logger.error(f"Failed to save uploaded video: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to save video: {e}")
    finally:
        await file.close()
        
    def _cleanup():
        try:
            os.remove(target_path)
        except Exception:
            pass

    # Open with the FFmpeg backend first (consistent with get_frame /
    # get_total_frames), then fall back to the default backend.
    cap = cv2.VideoCapture(target_path, cv2.CAP_FFMPEG)
    open_backend = "ffmpeg"
    if not cap.isOpened():
        cap.release()
        cap = cv2.VideoCapture(target_path)
        open_backend = "default"
    if not cap.isOpened():
        cap.release()
        _cleanup()
        logger.error("Upload rejected: OpenCV could not open %s with any backend", target_path)
        raise HTTPException(
            status_code=400,
            detail="OpenCV/FFmpeg could not open this file. The codec or container may be unsupported in this build.",
        )

    # CAP_PROP_FRAME_COUNT is unreliable (often 0) for VFR, webm, and phone
    # HEVC clips, so treat it as a hint — not a gate. Validate by actually
    # decoding the first frame instead.
    reported = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    ret, _ = cap.read()
    if not ret:
        cap.release()
        _cleanup()
        logger.error(
            "Upload rejected: %s opened (backend=%s, reported_frames=%d) but no decodable frames",
            target_path, open_backend, reported,
        )
        raise HTTPException(
            status_code=400,
            detail="Video opened but no decodable frames were found. The file may be corrupt or use an unsupported codec.",
        )

    # Establish a usable frame count for the slider. Trust the metadata when
    # it's positive; otherwise count by decoding forward (bounded).
    if reported > 0:
        total_frames = reported
    else:
        MAX_COUNT = 5000
        count = 1  # already read one frame above
        while count < MAX_COUNT:
            ok, _ = cap.read()
            if not ok:
                break
            count += 1
        total_frames = count
    cap.release()

    CURRENT_VIDEO_PATH = target_path
    reset_decision_cache()  # fresh reflex reasoning for the new feed
    _clear_frame_cache()    # invalidate memoized frames from the previous video
    logger.info(
        "Reflex video switched to: %s (backend=%s, reported=%d, total_frames=%d)",
        target_path, open_backend, reported, total_frames,
    )
    
    return {
        "status": "success",
        "filename": file.filename,
        "total_frames": total_frames
    }

@router.post("/api/reflex/reset_video")
async def reset_video():
    global CURRENT_VIDEO_PATH
    CURRENT_VIDEO_PATH = VIDEO_PATH
    reset_decision_cache()  # fresh reflex reasoning for the default feed
    _clear_frame_cache()    # invalidate memoized frames from the uploaded video

    cap = cv2.VideoCapture(CURRENT_VIDEO_PATH)
    total_frames = 0
    if cap.isOpened():
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        cap.release()
        
    logger.info("Reflex video reset to default")
    return {
        "status": "success",
        "total_frames": total_frames
    }
