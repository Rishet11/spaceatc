"""Build-time smoke check for the OrbitMind YOLO26 detector.

Run during the Docker build (see Dockerfile). It is intentionally NON-FATAL:
it prints a clear warning instead of failing the build, so that an unresolved
Git LFS pointer or a too-old ultralytics wheel is visible in the build log
rather than silently breaking OrbitMind inference at runtime. The app itself
degrades gracefully (the reflex endpoints return a clear 503 when assets are
missing), so the rest of the Space — globe, negotiation, metrics — still works.
"""

import os
import sys

WEIGHTS = os.path.join(os.path.dirname(__file__), "best (1).pt")
# Real YOLO26 weights are ~20 MB; a Git LFS pointer file is ~130 bytes.
LFS_STUB_MAX_BYTES = 1024


def main() -> int:
    if not os.path.exists(WEIGHTS):
        print(f"[build][WARN] YOLO weights missing: {WEIGHTS} — OrbitMind inference will be disabled.")
        return 0

    size = os.path.getsize(WEIGHTS)
    if size < LFS_STUB_MAX_BYTES:
        print(
            f"[build][WARN] {WEIGHTS} is {size} B — looks like an unresolved Git LFS pointer. "
            "Deploy the real binary (git lfs) for OrbitMind inference to work."
        )
        return 0

    try:
        from ultralytics import YOLO

        YOLO(WEIGHTS)
        print(f"[build][OK] YOLO26 weights loaded ({size / 1e6:.1f} MB) with installed ultralytics.")
    except Exception as e:  # too-old ultralytics for YOLO26, corrupt file, etc.
        print(
            f"[build][WARN] Could not load YOLO26 weights ({e!r}). "
            "Confirm the installed ultralytics version supports YOLO26. "
            "OrbitMind will degrade gracefully at runtime."
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
