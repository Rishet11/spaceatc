import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useSpaceStore } from '../../store/useSpaceStore';
import { geodeticToThreeJS } from './SatelliteLayer';
import { deriveVelocity, getPredictedPath, closestApproachIndex } from './orbits';
import { subsolarDirection } from './EarthMaterial';

const IDLE_DIST = 4.0;
// Distances tuned so the full orbit rings (radius up to ~1.15-1.2 for LEO
// altitude over a unit Earth) comfortably fit inside a 45deg vertical-FOV
// frustum with real margin — asin(1.2/d) needs to sit well under the 22.5deg
// half-FOV. 2.8/2.4 (and even 3.6/3.3) still read as "Earth fills the frame,
// rings clipped"; sitting close to IDLE_DIST is what actually leaves room to
// see both full rings crossing plus the post-maneuver divergence.
const DETECTED_DIST = 4.2;
// Share of viewport height the docked HITL panel occupies. Used to lift the
// scene out from behind it while that panel is open.
const BOTTOM_PANEL_FRACTION = 0.30;

// The view offset renders a (1 + BOTTOM_PANEL_FRACTION) taller virtual frame
// and crops to the real viewport, which magnifies by that same factor. Derive
// the pull-back from it so lifting the scene above the panel does not also
// zoom in and crop the orbit rings -- and so the two cannot drift apart.
const AWAITING_DIST = 4.0 * (1 + BOTTOM_PANEL_FRACTION);

// Furthest the camera may swing off the sun direction to bring the crossing
// into view. 70 deg puts it over the terminator: the globe stays substantially
// lit, and the day/night line is the most striking framing available.
const MAX_SUN_SWING_RAD = (70 * Math.PI) / 180;


function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}
function easeInCubic(t: number) {
  return t * t * t;
}

interface CameraDirectorProps {
  controlsRef: React.RefObject<any>;
}

// Replaces the inline CameraController. Keys off pipelineStage and, unlike
// the old version (which only lerped distance along the user's current
// angle), actively frames the conjunction: the camera sits on the BISECTOR
// of the two orbital-plane normals so both ellipses open up on screen
// instead of one flattening into a line when viewed down its own normal.
export const CameraDirector: React.FC<CameraDirectorProps> = ({ controlsRef }) => {
  const { camera, size } = useThree();
  const pipelineStage = useSpaceStore((s) => s.pipelineStage);
  const satellites = useSpaceStore((s) => s.satellites);
  const activeConjunctions = useSpaceStore((s) => s.activeConjunctions);
  const decisionOutcome = useSpaceStore((s) => s.decisionOutcome);

  // Sun barely moves over a demo session — computing this once per mount is
  // plenty accurate for picking which side of the bisector is sunlit.
  const sunDir = useMemo(() => subsolarDirection(new Date()), []);

  const bufRef = useRef<Map<string, THREE.Vector3[]>>(new Map());
  const stageRef = useRef(pipelineStage);
  const stageStartRef = useRef(Date.now());
  const startCamPos = useRef(new THREE.Vector3());
  const startLookAt = useRef(new THREE.Vector3(0, 0, 0));
  const currentLookAt = useRef(new THREE.Vector3(0, 0, 0));
  const driftAngle = useRef(0);
  // Animated vertical framing offset, in pixels of the real viewport. The HITL
  // panel is docked to the bottom of the screen and was covering the closest-
  // approach marker, which sits low in frame. Rather than move the camera
  // (which would also change how much of the orbit rings fit), shift the
  // rendered frustum so the scene composes into the space the panel leaves.
  const viewOffset = useRef(0);

  // Continuously-updated "last known good" framing, independent of stage —
  // used to freeze an exact, non-stale snapshot the instant we enter
  // 'resolved', rather than whatever camera.position happened to be.
  const lastBisector = useRef<THREE.Vector3 | null>(null);
  const lastTca = useRef<THREE.Vector3 | null>(null);
  const resolvedFraming = useRef<{ pos: THREE.Vector3; look: THREE.Vector3 } | null>(null);

  const active = activeConjunctions.find(
    (c) => c.status === 'detected' || c.status === 'negotiating' || c.status === 'pending_hitl'
  );
  const pair = decisionOutcome
    ? { satA: decisionOutcome.satA, satB: decisionOutcome.satB }
    : active
      ? { satA: active.sat_primary, satB: active.sat_secondary }
      : null;

  useEffect(() => {
    if (pipelineStage !== stageRef.current) {
      const enteringResolved = pipelineStage === 'resolved';
      stageRef.current = pipelineStage;
      stageStartRef.current = Date.now();
      startCamPos.current.copy(camera.position);
      startLookAt.current.copy(currentLookAt.current);
      if (enteringResolved) {
        const pos = lastBisector.current
          ? lastBisector.current.clone().multiplyScalar(AWAITING_DIST)
          : camera.position.clone();
        const look = lastTca.current ? lastTca.current.clone() : currentLookAt.current.clone();
        resolvedFraming.current = { pos, look };
      }
    }
  }, [pipelineStage, camera]);

  const posOf = (name: string): THREE.Vector3 | null => {
    const s = Object.values(satellites).find((x) => x.name === name);
    if (!s || s.lat === undefined || s.lon === undefined || s.alt_km === undefined) return null;
    return geodeticToThreeJS(s.lat, s.lon, s.alt_km);
  };

  useFrame((_, delta) => {
    const controls = controlsRef.current;

    // Track short position history per pair member for velocity derivation.
    if (pair) {
      [pair.satA, pair.satB].forEach((name) => {
        const p = posOf(name);
        if (!p) return;
        let buf = bufRef.current.get(name);
        if (!buf) {
          buf = [];
          bufRef.current.set(name, buf);
        }
        if (buf.length === 0 || buf[buf.length - 1].distanceTo(p) > 1e-4) {
          buf.push(p);
          if (buf.length > 3) buf.shift();
        }
      });
    }

    if (pipelineStage === 'idle') {
      if (controls) controls.enabled = true;
      currentLookAt.current.set(0, 0, 0);
      return;
    }

    // Everything below is a scripted shot: user orbit control is disabled.
    if (controls) controls.enabled = false;

    let bisector: THREE.Vector3 | null = null;
    let tcaPoint: THREE.Vector3 | null = null;

    if (pair) {
      const posA = posOf(pair.satA);
      const posB = posOf(pair.satB);
      const velA = deriveVelocity(bufRef.current.get(pair.satA) ?? []);
      const velB = deriveVelocity(bufRef.current.get(pair.satB) ?? []);

      if (posA && posB && velA && velB) {
        const n1 = posA.clone().cross(velA);
        const n2 = posB.clone().cross(velB);
        if (n1.lengthSq() > 1e-10 && n2.lengthSq() > 1e-10) {
          n1.normalize();
          n2.normalize();
          const b = n1.clone().add(n2);
          if (b.lengthSq() > 1e-10) {
            b.normalize();

            const arcA = getPredictedPath({ position: posA, velocity: velA, arcDeg: 65, steps: 48 });
            const arcB = getPredictedPath({ position: posB, velocity: velB, arcDeg: 65, steps: 48 });
            const tca =
              arcA.length && arcB.length
                ? (() => {
                    const ci = closestApproachIndex(arcA, arcB);
                    return arcA[ci].clone().lerp(arcB[ci], 0.5);
                  })()
                : posA.clone().add(posB).multiplyScalar(0.5);

            // Two competing constraints: the crossing should be on the near
            // side, and the globe should be lit. Flipping outright to satisfy
            // the first (what this used to do) hands back a black disc
            // whenever the encounter falls on the night side, which is most of
            // the time -- a dead frame on camera.
            //
            // Instead: start on the sunlit side and swing toward the crossing,
            // but cap the swing. At the cap the camera sits over the
            // terminator, which is the best of both -- a lit limb with city
            // lights running down the shadow line, and the crossing near the
            // edge of the disc rather than hidden behind it. The conjunction
            // arcs draw with depthTest disabled, so even a crossing just past
            // the limb stays visible.
            const sunSide = b.dot(sunDir) >= 0 ? b : b.clone().negate();
            const tcaDir = tca.clone().normalize();

            let finalB = sunSide;
            const swingAxis = new THREE.Vector3().crossVectors(sunSide, tcaDir);
            if (swingAxis.lengthSq() > 1e-8) {
              swingAxis.normalize();
              const swing = Math.min(sunSide.angleTo(tcaDir), MAX_SUN_SWING_RAD);
              finalB = sunSide.clone().applyAxisAngle(swingAxis, swing).normalize();
            }

            bisector = finalB;
            // Aiming the camera exactly AT the TCA point (a point on the
            // near surface, off-centre from the Earth's centre) pushed most
            // of the globe off-frame — the sphere's centre ends up shifted
            // toward the far edge of the screen. Aim at a point partway
            // between the TCA point and the Earth's centre instead: still
            // biased toward the crossing, but the full globe (and both full
            // orbit rings, which is the actual ask) stays in frame.
            tcaPoint = tca.clone().lerp(new THREE.Vector3(0, 0, 0), 0.55);
            lastBisector.current = finalB.clone();
            lastTca.current = tcaPoint.clone();
          }
        }
      }
    }

    if (!bisector || !tcaPoint) {
      // No live geometry this frame — hold the last known good framing
      // rather than degenerating to whatever camera.position currently is.
      bisector = lastBisector.current ?? camera.position.clone().normalize();
      tcaPoint = lastTca.current ?? currentLookAt.current.clone();
    }

    // --- Vertical framing: keep the crossing clear of the bottom panel ---
    // Only the HITL panel is bottom-docked, so only 'awaiting' needs the shift.
    const wantOffset = pipelineStage === 'awaiting' ? size.height * BOTTOM_PANEL_FRACTION : 0;
    viewOffset.current = THREE.MathUtils.damp(viewOffset.current, wantOffset, 4, delta);
    if (viewOffset.current > 0.5) {
      // Render rows [offset .. offset+height] of a taller virtual frame, which
      // lifts the scene centre above the middle of the real viewport.
      camera.setViewOffset(
        size.width,
        size.height + viewOffset.current,
        0,
        viewOffset.current,
        size.width,
        size.height,
      );
    } else if (camera.view?.enabled) {
      camera.clearViewOffset();
    }

    const stageElapsed = Date.now() - stageStartRef.current;

    switch (pipelineStage) {
      case 'detected': {
        const dur = 1800;
        const t = Math.min(1, stageElapsed / dur);
        const e = easeOutCubic(t);
        const targetPos = bisector.clone().multiplyScalar(DETECTED_DIST);
        camera.position.lerpVectors(startCamPos.current, targetPos, e);
        currentLookAt.current.lerpVectors(startLookAt.current, tcaPoint, e);
        camera.lookAt(currentLookAt.current);
        break;
      }
      case 'negotiating': {
        // Hold framing, slow drift around the lookAt point.
        driftAngle.current += 0.05 * delta;
        const held = bisector.clone().multiplyScalar(DETECTED_DIST);
        held.applyAxisAngle(tcaPoint.clone().normalize(), driftAngle.current);
        camera.position.copy(held);
        currentLookAt.current.copy(tcaPoint);
        camera.lookAt(currentLookAt.current);
        break;
      }
      case 'awaiting': {
        const dur = 1000;
        const t = Math.min(1, stageElapsed / dur);
        const e = easeOutCubic(t);
        const dist = THREE.MathUtils.lerp(DETECTED_DIST, AWAITING_DIST, e);
        camera.position.copy(bisector.clone().multiplyScalar(dist));
        currentLookAt.current.copy(tcaPoint);
        camera.lookAt(currentLookAt.current);
        break;
      }
      case 'resolved': {
        // Hold the EXACT framing captured the instant we entered 'resolved'
        // (same distance/angle as 'awaiting') so the pre/post-maneuver
        // divergence is legible instead of the camera punching in on the
        // Earth. Recomputing live here would both drift the "completely
        // still" shot and risk snapping to a bad frame right at the
        // transition, so this is a frozen snapshot, not a live recompute.
        const holdDur = 2000;
        const framing = resolvedFraming.current;
        if (framing && stageElapsed < holdDur) {
          camera.position.copy(framing.pos);
          currentLookAt.current.copy(framing.look);
          camera.lookAt(currentLookAt.current);
        } else if (framing) {
          const t = Math.min(1, (stageElapsed - holdDur) / 1800);
          const e = easeOutCubic(t);
          const targetPos = new THREE.Vector3(0, 0, IDLE_DIST);
          camera.position.lerpVectors(framing.pos, targetPos, e);
          currentLookAt.current.lerpVectors(framing.look, new THREE.Vector3(0, 0, 0), e);
          camera.lookAt(currentLookAt.current);
          if (t >= 1 && controls) {
            controls.target.copy(currentLookAt.current);
            controls.update();
            controls.enabled = true;
          }
        }
        break;
      }
      case 'collision': {
        const dur = 800;
        const t = Math.min(1, stageElapsed / dur);
        const e = easeInCubic(t);
        const punchPos = tcaPoint.clone().normalize().multiplyScalar(1.6);
        camera.position.lerpVectors(startCamPos.current, punchPos, e);
        currentLookAt.current.copy(tcaPoint);
        camera.lookAt(currentLookAt.current);
        break;
      }
      default:
        break;
    }

    // Keep OrbitControls' target in sync with the scripted lookAt so that
    // if/when it re-enables (see 'resolved' above), the next drag doesn't snap.
    if (controls) {
      controls.target.copy(currentLookAt.current);
    }
  });

  return null;
};
