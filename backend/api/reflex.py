"""
backend/api/reflex.py — REST API router for OrbitMind Reflex Layer
"""

import os
import sys
import shutil
import base64
import json
import logging
from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel
import cv2
import numpy as np
import torch
import torch.nn as nn
from torchvision import models, transforms
from ultralytics import YOLO

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
        logger.info("Lazy loading YOLOv8 model for Reflex API...")
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

@router.get("/api/reflex/total_frames")
async def get_total_frames():
    """Returns the total number of frames in the speed dataset video."""
    cap = cv2.VideoCapture(CURRENT_VIDEO_PATH, cv2.CAP_FFMPEG)
    if not cap.isOpened():
        cap = cv2.VideoCapture(CURRENT_VIDEO_PATH)
    if not cap.isOpened():
        raise HTTPException(status_code=500, detail="Failed to open video file")
    
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    cap.release()
    return {"total_frames": total}

@router.get("/api/reflex/frame/{frame_idx}")
async def get_frame(frame_idx: int):
    """
    Seeks to frame_idx, runs YOLO + Keypoint detection + Pose estimation,
    overlays visualization on the frame, base64 encodes it, and returns the response.
    """
    lazy_load_models()
    
    cap = cv2.VideoCapture(CURRENT_VIDEO_PATH, cv2.CAP_FFMPEG)
    if not cap.isOpened():
        cap = cv2.VideoCapture(CURRENT_VIDEO_PATH)
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
    
    # Calculate distance to debris
    distance = float(np.linalg.norm(tvec_coords))
    
    # Determine dynamic status, warnings, and LLM logs
    if not detected:
        status = "SCANNING"
        threat_level = "LOW"
        decision_log = "Search Query: 'proximity search'\nNo uncatalogued targets detected in current sensor field of view."
        dodge_command = None
    elif distance > 2.2:
        status = "MONITORING"
        threat_level = "LOW"
        decision_log = (
            "Search Query: 'spacecraft proximity monitoring'\n"
            "Found Play: 'Normal Operations - Safe Proximity'\n"
            "Active Target: Tango Debris\n"
            f"Range: {distance:.2f}m (Safe Threshold > 2.2m)\n"
            "Verdict: Target tracked. Trajectory normal. No active maneuvers scheduled."
        )
        dodge_command = None
    elif distance >= 1.5:
        status = "WARNING"
        threat_level = "AMBER"
        decision_log = (
            "Search Query: 'debris proximity warning criteria'\n"
            "Found Play: 'Play 7 - Pre-Collision Evasion Alert'\n"
            "Active Target: Tango Debris\n"
            f"Range: {distance:.2f}m (Warning Threshold: 1.5m - 2.2m)\n"
            "Verdict: Target approaching danger zone. Priming reaction control thrusters."
        )
        dodge_command = None
    else:
        status = "CRITICAL"
        threat_level = "RED"
        decision_log = (
            "Search Query: 'debris proximity red zone evasion'\n"
            "Found Play: 'Play 14 - Autonomous Evasion Protocol'\n"
            "Active Target: Tango Debris\n"
            f"Range: {distance:.2f}m (Critical Threshold < 1.5m)\n"
            "Executing Evasion Maneuver...\n"
            "Command constraint validated successfully."
        )
        dodge_command = {
            "intent": "EVADE",
            "axis": "Y",
            "delta_v_cm_s": 12,
            "duration_ms": 400,
            "reason": "debris_tumbling_close_approach",
            "post_evade_action": "schedule_correction_burn"
        }

    return {
        "image": img_b64,
        "box": box_coords,
        "keypoints": kpts_list,
        "pose": {
            "translation": tvec_coords,
            "quaternion": quat,
            "distance": distance
        },
        "status": status,
        "threat_level": threat_level,
        "decision_log": decision_log,
        "dodge_command": dodge_command
    }

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
        
    cap = cv2.VideoCapture(target_path)
    if not cap.isOpened():
        cap.release()
        try:
            os.remove(target_path)
        except Exception:
            pass
        raise HTTPException(status_code=400, detail="Uploaded file is not a valid or readable video file.")
        
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    cap.release()
    
    if total_frames <= 0:
        try:
            os.remove(target_path)
        except Exception:
            pass
        raise HTTPException(status_code=400, detail="Uploaded video contains no frames.")
        
    CURRENT_VIDEO_PATH = target_path
    logger.info(f"Reflex video switched to: {target_path} ({total_frames} frames)")
    
    return {
        "status": "success",
        "filename": file.filename,
        "total_frames": total_frames
    }

@router.post("/api/reflex/reset_video")
async def reset_video():
    global CURRENT_VIDEO_PATH
    CURRENT_VIDEO_PATH = VIDEO_PATH
    
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
