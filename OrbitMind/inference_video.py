import os
import sys

# macOS OpenMP duplicate library crash fix: dynamically locate and preload PyTorch's libomp.dylib
if sys.platform == "darwin" and "DYLD_INSERT_LIBRARIES" not in os.environ:
    os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"
    try:
        import torch
        torch_lib_dir = os.path.join(os.path.dirname(torch.__file__), "lib")
        torch_omp = os.path.join(torch_lib_dir, "libomp.dylib")
        if os.path.exists(torch_omp):
            os.environ["DYLD_INSERT_LIBRARIES"] = torch_omp
            os.execve(sys.executable, [sys.executable] + sys.argv, os.environ)
    except Exception:
        pass

# Mock out Ultralytics events/telemetry call to prevent background thread spawning
try:
    import ultralytics.utils.events
    ultralytics.utils.events.Events.__call__ = lambda *args, **kwargs: None
except Exception:
    pass

import cv2
import numpy as np
import torch
import torch.nn as nn
from torchvision import models, transforms
from ultralytics import YOLO
import argparse
import json
from tqdm import tqdm

# ============================================================
# CONFIG
# ============================================================
CFG = {
    "crop_size": 224,
    "num_keypoints": 11,
    "yolo_conf": 0.10,
    "yolo_iou": 0.45,
    "bbox_margin": 0.07,
    "device": "cuda" if torch.cuda.is_available() else ("mps" if torch.backends.mps.is_available() else "cpu")
}

NUM_COORDS = CFG["num_keypoints"] * 2

EDGES = [
    (0,1), (1,2), (2,3), (3,0),   # face 1
    (4,5), (5,6), (6,7), (7,4),   # face 2
    (0,4), (1,5), (2,6), (3,7)    # connecting edges
]

# Generic fallback 3D keypoints (11 points) for when tangoPoints.mat is missing.
FALLBACK_KP3D = np.array([
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
    [0, 0, -1.5], [0, 0, 1.5], [1.5, 0, 0]
], dtype=np.float32)

# ============================================================
# MODEL: KeypointMobileNet
# ============================================================
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

transform = transforms.Compose([
    transforms.ToPILImage(),
    transforms.Resize((CFG["crop_size"], CFG["crop_size"])),
    transforms.ToTensor(),
    transforms.Normalize(_MEAN, _STD)
])

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

def estimate_pose(kpts_2d, kp3d, K, distCoeffs):
    success, rvec, tvec = cv2.solvePnP(
        np.ascontiguousarray(kp3d, dtype=np.float32),
        np.ascontiguousarray(kpts_2d, dtype=np.float32),
        np.ascontiguousarray(K, dtype=np.float32),
        np.ascontiguousarray(distCoeffs, dtype=np.float32),
        flags=cv2.SOLVEPNP_EPNP
    )
    if not success:
        return None
    R, _ = cv2.Rodrigues(rvec)
    quat = rotation_matrix_to_quaternion(R)
    return quat, tvec

def process_frame(frame, yolo_model, kpt_model, kp3d, K, distCoeffs, device):
    h, w = frame.shape[:2]
    
    # YOLO prediction
    results = yolo_model(frame, conf=CFG["yolo_conf"], iou=CFG["yolo_iou"], verbose=False)
    
    out_frame = frame.copy()
    pose_telemetry = None
    
    for result in results:
        boxes = result.boxes
        if len(boxes) == 0:
            continue
            
        box = boxes[0].xyxy[0].cpu().numpy()
        x1, y1, x2, y2 = box
        
        # Add margin
        bw, bh = x2 - x1, y2 - y1
        mx, my = bw * CFG["bbox_margin"], bh * CFG["bbox_margin"]
        cx1, cy1 = max(0, int(x1 - mx)), max(0, int(y1 - my))
        cx2, cy2 = min(w, int(x2 + mx)), min(h, int(y2 + my))
        
        crop = frame[cy1:cy2, cx1:cx2]
        if crop.size == 0:
            continue
            
        # Keypoint prediction
        inp = transform(crop).unsqueeze(0).to(device)
        with torch.no_grad():
            pred = kpt_model(inp)[0].cpu().numpy()
            
        # Scale keypoints back to frame space
        cbw, cbh = cx2 - cx1, cy2 - cy1
        kpts = np.stack([pred[0::2] * cbw + cx1, pred[1::2] * cbh + cy1], axis=-1)
        
        # Pose Estimation
        pose = estimate_pose(kpts, kp3d, K, distCoeffs)
        if pose is not None:
            quat, tvec = pose
            distance = float(np.linalg.norm(tvec))
            pose_telemetry = {
                "translation": [float(t[0]) for t in tvec],
                "quaternion": [float(q) for q in quat],
                "distance": distance
            }
            
        # Draw Bounding Box
        cv2.rectangle(out_frame, (int(x1), int(y1)), (int(x2), int(y2)), (0, 255, 0), 2)
        
        # Draw wireframe edges
        for s, e in EDGES:
            if s < len(kpts) and e < len(kpts):
                cv2.line(out_frame, (int(kpts[s, 0]), int(kpts[s, 1])), (int(kpts[e, 0]), int(kpts[e, 1])), (0, 255, 255), 2)
                
        # Draw Keypoint nodes
        for i, (px, py) in enumerate(kpts):
            cv2.circle(out_frame, (int(px), int(py)), 5, (0, 0, 255), -1)
            cv2.putText(out_frame, str(i), (int(px) + 4, int(py) - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 255, 255), 1)
            
        # If pose estimated, draw telemetry text overlay
        if pose_telemetry:
            t = pose_telemetry["translation"]
            q = pose_telemetry["quaternion"]
            cv2.putText(out_frame, f"T: [{t[0]:.2f}, {t[1]:.2f}, {t[2]:.2f}]", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
            cv2.putText(out_frame, f"Q: [{q[0]:.2f}, {q[1]:.2f}, {q[2]:.2f}, {q[3]:.2f}]", (10, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
            cv2.putText(out_frame, f"D: {pose_telemetry['distance']:.2f}m", (10, 90), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)
            
        # Break after processing first detected box
        break
        
    return out_frame, pose_telemetry

def main():
    parser = argparse.ArgumentParser(description="OrbitMind Video Inference Script")
    parser.add_argument("--video", type=str, default="output_h264.mp4", help="Path to input video")
    parser.add_argument("--output", type=str, default="output_inference.mp4", help="Path to save output video")
    parser.add_argument("--yolo", type=str, default="best (1).pt", help="Path to YOLO26 weights")
    parser.add_argument("--kpt", type=str, default="keypoint_mobilenet.pth", help="Path to KeypointMobileNet weights")
    parser.add_argument("--camera_json", type=str, default="camera.json", help="Path to camera matrix JSON")
    parser.add_argument("--tango_mat", type=str, default="tangoPoints.mat", help="Path to tangoPoints MAT file")
    
    args = parser.parse_args()
    
    # Check paths
    if not os.path.exists(args.video):
        print(f"Error: Input video {args.video} not found.")
        return
    if not os.path.exists(args.yolo):
        print(f"Error: YOLO weights {args.yolo} not found.")
        return
    if not os.path.exists(args.kpt):
        print(f"Error: Keypoint weights {args.kpt} not found.")
        return
        
    print(f"Using device: {CFG['device']}")
    
    # Load Models
    print("Loading YOLO26 model...")
    yolo_model = YOLO(args.yolo)
    
    print("Loading KeypointMobileNet...")
    kpt_model = KeypointMobileNet(NUM_COORDS)
    ckpt = torch.load(args.kpt, map_location=CFG["device"], weights_only=False)
    state_dict = ckpt["state_dict"] if "state_dict" in ckpt else ckpt
    kpt_model.load_state_dict(state_dict)
    kpt_model.to(CFG["device"])
    kpt_model.eval()
    
    # Load Camera Intrinsics
    if os.path.exists(args.camera_json):
        print(f"Loading camera parameters from {args.camera_json}...")
        with open(args.camera_json) as f:
            cam = json.load(f)
        K = np.array(cam["cameraMatrix"], dtype=np.float32)
        distCoeffs = np.array(cam["distCoeffs"], dtype=np.float32).ravel()
    else:
        print("Warning: camera.json not found, using generic intrinsics.")
        K = np.array([[1000, 0, 960], [0, 1000, 600], [0, 0, 1]], dtype=np.float32)
        distCoeffs = np.zeros(5, dtype=np.float32)
        
    # Load 3D Keypoints
    if os.path.exists(args.tango_mat):
        print(f"Loading 3D tango points from {args.tango_mat}...")
        from scipy.io import loadmat
        kp3d = np.ascontiguousarray(loadmat(args.tango_mat)["tango3Dpoints"].T).astype(np.float32)
    else:
        print("Warning: tangoPoints.mat not found, using fallback 3D keypoints.")
        kp3d = FALLBACK_KP3D
        
    # Open Video
    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        print("Error: Could not open video file.")
        return
        
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    
    print(f"Processing video: {w}x{h} @ {fps} FPS, {total_frames} frames.")
    
    # Video Writer
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(args.output, fourcc, fps, (w, h))
    
    try:
        for _ in tqdm(range(total_frames)):
            ret, frame = cap.read()
            if not ret:
                break
                
            annotated_frame, telemetry = process_frame(
                frame, yolo_model, kpt_model, kp3d, K, distCoeffs, CFG["device"]
            )
            out.write(annotated_frame)
    except KeyboardInterrupt:
        print("\nInterrupted by user.")
    finally:
        cap.release()
        out.release()
        print(f"Finished. Saved output video to {args.output}")

if __name__ == "__main__":
    main()