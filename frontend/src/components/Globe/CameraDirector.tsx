import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useSpaceStore } from '../../store/useSpaceStore';
import { geodeticToThreeJS } from './SatelliteLayer';
import { deriveVelocity, getPredictedPath, closestApproachIndex } from './orbits';
import { subsolarDirection } from './EarthMaterial';
import { HITL_PANEL_HEIGHT_PX } from '../HITLPanel/HITLPanel';

const IDLE_DIST = 4.0;
// Distances tuned so the full orbit rings (radius up to ~1.15-1.2 for LEO
// altitude over a unit Earth) comfortably fit inside a 45deg vertical-FOV
// frustum with real margin — asin(1.2/d) needs to sit well under the 22.5deg
// half-FOV. 2.8/2.4 (and even 3.6/3.3) still read as "Earth fills the frame,
// rings clipped"; sitting close to IDLE_DIST is what actually leaves room to
// see both full rings crossing plus the post-maneuver divergence.
const DETECTED_DIST = 4.2;
// Share of viewport height the docked HITL panel used to occupy. Kept only
// to size the small pull-back below -- the panel is short enough now (see
// AWAITING_DIST) that no vertical shift is needed to clear it, so this no
// longer feeds any lookAt offset.
const BOTTOM_PANEL_FRACTION = 0.30;

// Pull-back distance while awaiting a decision: a bit further out than
// DETECTED_DIST so the docked HITL panel has less chance of overlapping the
// closest-approach marker. Distance-only -- never shift the lookAt point
// vertically to dodge the panel, that made the globe slide off-centre.
const AWAITING_DIST = 4.0 * (1 + BOTTOM_PANEL_FRACTION);

// Furthest the camera may swing off the sun direction to bring the crossing
// into view. 70 deg puts it over the terminator: the globe stays substantially
// lit, and the day/night line is the most striking framing available.
const MAX_SUN_SWING_RAD = (70 * Math.PI) / 180;

// How close the camera punches in on a veto, and how far it pulls back out
// afterwards so the debris cloud reads as an event within its surroundings
// rather than filling the whole screen.
const COLLISION_PUNCH_DIST = 1.6;
const COLLISION_AFTERMATH_DIST = IDLE_DIST;

// The Canvas camera's own fov prop (Globe.tsx) -- vertical field of view in
// degrees, fixed regardless of the canvas's pixel height. Because it's a
// vertical angle rather than a pixel measurement, every bound derived from
// it below holds at any viewport height.
const VERTICAL_FOV_DEG = 45;
const HALF_FOV_RAD = (VERTICAL_FOV_DEG * Math.PI) / 180 / 2;
// Stay this far inside the true frustum edge as float/render slop margin.
const LIFT_SAFETY_MARGIN_RAD = (2 * Math.PI) / 180;
// Design ceiling: however much room the live clamp below would allow, never
// lift by more than this. "A bit," not the ~30%-of-viewport overshoot a
// previous version pushed off the top of the screen.
const MAX_LIFT_RAD = (6 * Math.PI) / 180;
// Only need to clear roughly half the panel's angular footprint: the globe
// is being recentred in the space still visible above the panel, not
// relocated by the panel's full height.
const LIFT_PANEL_COVERAGE = 0.5;

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

  // Once the user drags or scrolls, the director stops overriding the camera
  // for the rest of the current stage -- reset on the next stage transition.
  const userTookControlRef = useRef(false);
  const controlsListenerAttachedRef = useRef(false);

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
      userTookControlRef.current = false;
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

    // OrbitControls only reports drags/scrolls while enabled, so it must stay
    // enabled through every stage for the "user input always wins" handoff
    // below to ever see a 'start' event in the first place.
    if (controls) {
      controls.enabled = true;
      if (!controlsListenerAttachedRef.current) {
        controls.addEventListener('start', () => {
          userTookControlRef.current = true;
        });
        controlsListenerAttachedRef.current = true;
      }
    }

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
      currentLookAt.current.set(0, 0, 0);
      return;
    }

    // Once the user grabs the camera mid-stage, yield for good: stop writing
    // camera.position/lookAt entirely until the next stage transition resets
    // userTookControlRef, so OrbitControls (already enabled above) drives
    // uncontested. Manual zoom-out and orbiting always work as a result.
    if (userTookControlRef.current) {
      return;
    }

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

        // Small bounded lift while the HITL panel is docked at the bottom
        // of the screen: nudge the aim point DOWN, which pushes the
        // rendered globe UP, clear of the panel. Reuses `e` above so the
        // lift eases in over the same window as the pull-back rather than
        // snapping in; it eases back out for free when the next stage
        // (resolved/collision) takes over and animates away from wherever
        // the camera currently sits.
        //
        // The size is derived from the panel's real height so it lifts
        // "just enough" (LIFT_PANEL_COVERAGE), then clamped twice: once by
        // MAX_LIFT_RAD (a small design ceiling) and once by a live
        // geometric bound computed from THIS frame's actual camera
        // distance and aim-point offset, so the globe's top edge can never
        // clip the frustum no matter where the conjunction currently sits
        // or how tall the viewport is.
        const panelFovFrac = Math.min(1, HITL_PANEL_HEIGHT_PX / size.height);
        const desiredLiftRad = panelFovFrac * (HALF_FOV_RAD * 2) * LIFT_PANEL_COVERAGE;

        const sphereHalfAngleRad = Math.asin(Math.min(1, 1 / dist));
        const toOriginDir = camera.position.clone().negate().normalize();
        const viewDir = tcaPoint.clone().sub(camera.position).normalize();
        const offCenterRad = viewDir.angleTo(toOriginDir);
        const availableLiftRad = Math.max(
          0,
          HALF_FOV_RAD - LIFT_SAFETY_MARGIN_RAD - sphereHalfAngleRad - offCenterRad
        );

        const liftRad = Math.min(desiredLiftRad, MAX_LIFT_RAD, availableLiftRad) * e;
        // Convert the angular lift to a world-space offset using the
        // camera's distance to the point actually being shifted (tcaPoint),
        // not its distance to the origin -- tcaPoint sits up to ~0.45 units
        // closer to the camera (it's lerped 55% toward the origin from a
        // point near the sphere's surface), and using the longer distance
        // there would understate the resulting angular shift, quietly
        // eating into the safety margin computed above.
        const camToTcaDist = camera.position.distanceTo(tcaPoint);
        const liftWorld = camToTcaDist * Math.tan(liftRad);
        const up = camera.up.clone().normalize();
        currentLookAt.current.copy(tcaPoint).sub(up.multiplyScalar(liftWorld));
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
          }
        }
        break;
      }
      case 'collision': {
        // Punch in on the debris for impact, hold so the explosion reads,
        // then pull back out to a context shot. Past that the camera is left
        // alone entirely so OrbitControls (enabled, target already synced)
        // drives freely -- otherwise this case would keep re-copying
        // punchPos forever and trap the camera inside the debris cloud with
        // no way to zoom out.
        const punchDur = 800;
        const holdDur = 1200;
        const pullbackDur = 1800;
        const punchPos = tcaPoint.clone().normalize().multiplyScalar(COLLISION_PUNCH_DIST);

        if (stageElapsed < punchDur) {
          const e = easeInCubic(stageElapsed / punchDur);
          camera.position.lerpVectors(startCamPos.current, punchPos, e);
          currentLookAt.current.copy(tcaPoint);
          camera.lookAt(currentLookAt.current);
        } else if (stageElapsed < punchDur + holdDur) {
          camera.position.copy(punchPos);
          currentLookAt.current.copy(tcaPoint);
          camera.lookAt(currentLookAt.current);
        } else if (stageElapsed < punchDur + holdDur + pullbackDur) {
          const t = Math.min(1, (stageElapsed - punchDur - holdDur) / pullbackDur);
          const e = easeOutCubic(t);
          const aftermathPos = tcaPoint.clone().normalize().multiplyScalar(COLLISION_AFTERMATH_DIST);
          camera.position.lerpVectors(punchPos, aftermathPos, e);
          currentLookAt.current.lerpVectors(tcaPoint, new THREE.Vector3(0, 0, 0), e);
          camera.lookAt(currentLookAt.current);
          if (t >= 1 && controls) {
            controls.target.copy(currentLookAt.current);
            controls.update();
          }
        }
        break;
      }
      default:
        break;
    }

    // Keep OrbitControls' target in sync with the scripted lookAt so that
    // whenever the user takes over, their next drag doesn't snap.
    if (controls) {
      controls.target.copy(currentLookAt.current);
    }
  });

  return null;
};
