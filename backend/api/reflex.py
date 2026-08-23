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
import time
from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel
import cv2
import numpy as np
# torch / torchvision / ultralytics are imported lazily (inside lazy_load_models
# and the inference helpers) so importing this module does not pull the whole ML
# stack at app startup. That import costs ~30s and was making the deployed
# container slow to bind its port, so the platform never promoted the new build.

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
    # Matches the training resolution (OrbitMind/improved-yolo-spn.ipynb,
    # imgsz=800) — measured ~1.9x faster than the implicit ultralytics default
    # on a native 1920x1200 frame, since it's both correct for accuracy and
    # cheaper than auto-sizing to the raw frame.
    "yolo_imgsz": 800,
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

_MEAN = [0.485, 0.456, 0.406]
_STD  = [0.229, 0.224, 0.225]
_TRANSFORM = None  # built lazily on first model load (torchvision import deferred)


def _build_transform():
    from torchvision import transforms
    return transforms.Compose([
        transforms.ToPILImage(),
        transforms.Resize((CFG["crop_size"], CFG["crop_size"])),
        transforms.ToTensor(),
        transforms.Normalize(_MEAN, _STD),
    ])


def _build_kpt_model(num_coords):
    """Define + instantiate the keypoint model. torch/torchvision are imported
    here so module import (and app startup) does not pay their cost."""
    import torch.nn as nn
    from torchvision import models

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
                nn.Sigmoid(),
            )

        def forward(self, x):
            return self.head(self.backbone(x))

    return KeypointMobileNet(num_coords)

def lazy_load_models():
    global YOLO_MODEL, KPT_MODEL, K, DIST_COEFFS, KP3D, _TRANSFORM
    import torch
    from ultralytics import YOLO
    # Silence ultralytics telemetry here (deferred import). Its background
    # thread can segfault under OpenMP on macOS.
    try:
        import ultralytics.utils.events as _uevents
        _uevents.Events.__call__ = lambda *a, **k: None
    except Exception:
        pass

    device = CFG["device"]

    if _TRANSFORM is None:
        _TRANSFORM = _build_transform()

    if YOLO_MODEL is None:
        logger.info("Lazy loading YOLO26 model for Reflex API...")
        YOLO_MODEL = YOLO(YOLO_WEIGHTS)

    if KPT_MODEL is None:
        logger.info("Lazy loading KeypointMobileNet model for Reflex API...")
        ckpt = torch.load(KPT_WEIGHTS, map_location=device, weights_only=False)
        KPT_MODEL = _build_kpt_model(NUM_COORDS)
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
            logger.info("Loaded camera intrinsics from %s (metric range enabled)", os.path.basename(CAMERA_JSON))
        else:
            logger.warning("camera.json missing; using synthetic intrinsics (range is relative, not metric)")
            K = np.array([[1000, 0, 960], [0, 1000, 600], [0, 0, 1]], dtype=np.float32)
            DIST_COEFFS = np.zeros(5, dtype=np.float32)

    if KP3D is None:
        if os.path.exists(TANGO_MAT):
            from scipy.io import loadmat
            KP3D = np.ascontiguousarray(loadmat(TANGO_MAT)["tango3Dpoints"].T).astype(np.float32)
        else:
            logger.warning("tangoPoints.mat missing; using generic keypoint cube")
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


# Precomputed frame-by-frame responses for the bundled default clip, baked to
# disk by OrbitMind/precompute_cache.py. Loading these at startup means the
# clip judges actually see plays back instantly on a fresh container, instead
# of paying ~0.3s/frame of CPU inference for every frame on every cold start.
BAKED_CACHE_DIR = os.path.join(ORBITMIND_DIR, "cache")


def _baked_cache_file(mode: str) -> str:
    return os.path.join(BAKED_CACHE_DIR, f"output_h264__{mode}.json")


def _load_baked_cache():
    """Load precomputed responses for the default clip into the in-memory
    caches. A no-op if the default video or a cache file is missing (e.g. an
    LFS stub, or the cache hasn't been generated yet) — falls back to live
    inference for whatever isn't loaded."""
    if _missing_or_stub(VIDEO_PATH):
        return
    for mode in ("live", "replay"):
        path = _baked_cache_file(mode)
        if not os.path.exists(path):
            continue
        try:
            with open(path) as f:
                data = json.load(f)
            frames = data.get("frames", {})
            for idx_str, response in frames.items():
                _FRAME_CACHE[(VIDEO_PATH, int(idx_str), mode)] = response
            total = data.get("total_frames", len(frames))
            _TOTAL_CACHE[VIDEO_PATH] = total
            _PREWARM[(VIDEO_PATH, mode)] = {"ready": len(frames), "total": total, "done": True}
            logger.info("Loaded baked cache %s: %d frames (mode=%s)", os.path.basename(path), len(frames), mode)
        except Exception as e:
            logger.warning("Failed to load baked cache %s: %s", path, e)


_load_baked_cache()


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
    import torch  # deferred ML import (already resident after lazy_load_models)
    with _INFER_LOCK:
        t_start = time.monotonic()
        cap = _open_capture(CURRENT_VIDEO_PATH)
        if not cap.isOpened():
            raise HTTPException(status_code=500, detail="Failed to open video file")
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ret, frame = cap.read()
        cap.release()
        if not ret:
            raise HTTPException(status_code=400, detail=f"Could not read frame {frame_idx}")
        t_decode = time.monotonic()

        img_h, img_w = frame.shape[:2]

        # Run YOLO prediction
        results = YOLO_MODEL(
            frame, conf=CFG["yolo_conf"], iou=CFG["yolo_iou"],
            imgsz=CFG["yolo_imgsz"], verbose=False,
        )
        t_yolo = time.monotonic()

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
            inp = _TRANSFORM(crop).unsqueeze(0).to(CFG["device"])
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

        t_kpt = time.monotonic()

        # Encode frame to Base64. Quality 85 is visually indistinguishable from
        # the default 95 in a browser preview panel but cuts payload ~40%,
        # which matters both for live HTTP responses and the baked cache size.
        _, jpeg_buffer = cv2.imencode('.jpg', out_frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
        img_b64 = base64.b64encode(jpeg_buffer).decode('utf-8')
        t_encode = time.monotonic()

        logger.info(
            "frame %d timing (ms): decode=%.0f yolo=%.0f keypoint+pose=%.0f encode=%.0f total=%.0f",
            frame_idx,
            (t_decode - t_start) * 1000,
            (t_yolo - t_decode) * 1000,
            (t_kpt - t_yolo) * 1000,
            (t_encode - t_kpt) * 1000,
            (t_encode - t_start) * 1000,
        )

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


async def _compute_frame(
    frame_idx: int, mode: str | None, force_bad_narrative: bool = False
) -> dict:
    """Cache-or-compute a fully decorated frame response (CV + agent decision).

    The heavy CV/pose inference runs in a worker thread so the event loop stays
    responsive (and so a background prewarm doesn't block interactive requests);
    the agent reasoning is generated by retrieval + an LLM with a deterministic
    guardrail and rule-based fallback (see reflex_playbook), cached per band.

    ``force_bad_narrative`` is DEMO SCAFFOLDING (default False, see
    reflex_playbook._DEMO_BAD_NARRATIVE): when True this call bypasses
    ``_FRAME_CACHE`` entirely — no read, no write — so a forced-bad demo
    request can never be served back on a later normal request for the same
    (video, frame, mode), and never evicts/overwrites the real cached result.
    """
    cache_key = (CURRENT_VIDEO_PATH, frame_idx, mode or "live")
    if not force_bad_narrative:
        cached = _FRAME_CACHE.get(cache_key)
        if cached is not None:
            return cached

    _require_video(CURRENT_VIDEO_PATH)
    _require_inference_assets()
    lazy_load_models()

    partial = await asyncio.to_thread(_infer_frame_blocking, frame_idx, mode)

    decision_log, dodge_command, content_review = await reflex_decision(
        partial["status"], partial["threat_level"], partial["detected"],
        partial["distance"], partial["tvec"], partial["quat"],
        force_bad_narrative=force_bad_narrative,
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
        "content_review": content_review,
    }
    if not force_bad_narrative:
        _FRAME_CACHE[cache_key] = response
    return response


@router.get("/api/reflex/frame/{frame_idx}")
async def get_frame(
    frame_idx: int, mode: str | None = None, force_bad_narrative: bool = False
):
    """Run detection + pose + the onboard agent decision for one frame.

    ``mode='replay'`` sweeps the relative range across the threat bands to
    demonstrate the full autonomous decision policy (detection stays live; the
    range is an explicitly-labeled swept input). Results are memoized per
    (video, frame, mode).

    ``force_bad_narrative`` is DEMO SCAFFOLDING (default False): opt-in query
    param that forces the onboard reflex narrative through a deliberately
    malformed, hardcoded fixture so the real content-review gate genuinely
    rejects it and the deterministic safe fallback ships instead — used to
    demonstrate the "SAFE FALLBACK" pill live. It never reads or writes the
    frame cache, so it cannot affect any other request.
    """
    return await _compute_frame(frame_idx, mode, force_bad_narrative=force_bad_narrative)


# Uploaded clips run live inference on CPU, so prewarming every frame of a long
# clip is slow. Compute an evenly spaced subset (about PREWARM_TARGET frames) and
# reuse each one for the gap until the next, which bounds buffering time
# regardless of clip length. setdefault never overwrites the baked default-clip
# frames, so the bundled clip stays full resolution.
PREWARM_TARGET = 120


async def _prewarm_worker(video_path: str, mode: str | None, total: int):
    """Compute an evenly spaced subset of (video_path, mode) into the cache and
    backfill the gaps with the nearest computed frame, so the slider and playback
    hit the cache for every index without running inference on every frame."""
    key = (video_path, mode or "live")
    m = mode or "live"
    stride = max(1, (total + PREWARM_TARGET - 1) // PREWARM_TARGET)
    try:
        for i in range(0, total, stride):
            # Stop if the active video was swapped out from under us.
            if CURRENT_VIDEO_PATH != video_path:
                break
            try:
                response = await _compute_frame(i, mode)
            except Exception as e:  # noqa: BLE001: one bad frame must not kill prewarm
                logger.warning("Prewarm frame %d failed: %s", i, e)
                response = None
            # Reuse this frame across the gap up to the next computed index.
            if response is not None:
                for j in range(i + 1, min(i + stride, total)):
                    _FRAME_CACHE.setdefault((video_path, j, m), response)
            st = _PREWARM.get(key)
            if st is None:
                break
            st["ready"] = min(total, i + stride)
    finally:
        st = _PREWARM.get(key)
        if st is not None:
            st["ready"] = total
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
        # A few hundred frames is already enough for a usable slider; capping
        # this low bounds worst-case upload latency for clips with unreliable
        # frame-count metadata (VFR/webm/phone HEVC) instead of decoding
        # thousands of frames just to count them.
        MAX_COUNT = 600
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
    _load_baked_cache()     # restore the precomputed default-clip cache wiped above

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
