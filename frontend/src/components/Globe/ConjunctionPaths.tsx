import React, { useRef, useReducer, useState, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Line, Html } from '@react-three/drei';
import { useSpaceStore } from '../../store/useSpaceStore';
import { geodeticToThreeJS } from './SatelliteLayer';
import {
  deriveVelocity,
  getPredictedPath,
  bentPathParams,
  closestApproachIndex,
  TRAJECTORY_SOURCE,
} from './orbits';
import { OrbitRing } from './OrbitRing';
import { TCAMarker } from './TCAMarker';

const ARC_DEG = 65;
const STEPS = 72;
const BEND_MS = 1300; // duration of the post-maneuver path "swing"

// Identity colours — these are the path BODY colours and never change with
// status. Red/amber/green stay status colours, used only on the TCA marker
// and the post-maneuver path. This is what fixes "looks like one line".
const PRIMARY = '#4fc3f7'; // cyan
const SECONDARY = '#c084fc'; // violet
const AMBER = '#ffb347';
const GREEN = '#22c55e';
const RED = '#ff4d4d';

interface BackendArcs {
  points: Record<string, THREE.Vector3[]>; // satellite name -> propagated path
  tcaIndex: number;
  postManeuver: {
    satellite: string;
    points: THREE.Vector3[];
    // Displacement from where this satellite would otherwise have been. Drives
    // the visual exaggeration factor -- NOT the same quantity as the miss
    // distance to the other object, and never shown as such.
    maxSeparationKm: number;
    // Miss distance to the other satellite after the burn: the number that
    // pairs with the "before" figure in the readouts.
    missAfterKm: number | null;
  } | null;
}

// The real post-maneuver displacement peaks at a few km on a globe drawn at
// scene radius 1.0 for a 6371 km Earth — a few thousandths of a scene unit,
// invisible. Exaggerate the displacement from the original track for
// legibility, and say so on screen (see the caption below); this is standard
// practice in scientific visualisation, not a fudge of the underlying numbers.
const SEPARATION_EXAGGERATION = 650;

// A dashed active arc with an additive glow underlay and a marching dash flow
// toward the closest-approach point.
const ActiveArc: React.FC<{ points: THREE.Vector3[]; color: string; approved: boolean }> = ({
  points,
  color,
  approved,
}) => {
  const lineRef = useRef<any>(null);
  const glowRef = useRef<any>(null);

  useFrame((_, delta) => {
    const speed = 0.4; // units/sec of dash-pattern travel
    if (lineRef.current?.material) {
      lineRef.current.material.dashOffset -= speed * delta;
    }
  });

  useEffect(() => {
    // Belt-and-suspenders: drei's Line already calls computeLineDistances()
    // on point changes, but dashes need distances present before the very
    // first paint too.
    lineRef.current?.computeLineDistances?.();
    glowRef.current?.computeLineDistances?.();
  }, [points]);

  const width = approved ? 3 : 5;

  return (
    <>
      {/* Cheap glow: identical points, wider, faint, additive */}
      <Line
        ref={glowRef}
        points={points}
        color={color}
        lineWidth={width * 3}
        transparent
        opacity={0.15}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        depthTest={false}
        renderOrder={10}
      />
      <Line
        ref={lineRef}
        points={points}
        color={color}
        lineWidth={width}
        transparent
        opacity={approved ? 0.55 : 0.95}
        depthWrite={false}
        depthTest={false}
        renderOrder={11}
        dashed
        dashSize={0.03}
        gapSize={0.015}
      />
    </>
  );
};

// OutcomeOverlay.tsx (not owned by this task) clears decisionOutcome from the
// store 3.6s after it's set. But pipelineStage's flip to 'resolved' (which is
// what settles the camera into its wide hold — see CameraDirector) rides on
// a separate WS 'maneuver_executed' broadcast that can arrive well after that
// — observed 10-14s after approval in testing. Without decoupling from the
// store's own decisionOutcome lifetime, the green post-maneuver path and its
// caption can vanish before the camera ever finishes framing the shot. Hold
// a local copy for longer so the two aren't racing each other.
const DECISION_HOLD_MS = 12000;

export const ConjunctionPaths: React.FC = () => {
  const satellites = useSpaceStore((s) => s.satellites);
  const activeConjunctions = useSpaceStore((s) => s.activeConjunctions);
  const decisionOutcome = useSpaceStore((s) => s.decisionOutcome);

  const bufRef = useRef<Map<string, THREE.Vector3[]>>(new Map());
  const [, force] = useReducer((x) => x + 1, 0);
  const [backendArcs, setBackendArcs] = useState<BackendArcs | null>(null);
  // The event's pre-maneuver miss distance, remembered past the point where
  // it drops out of activeConjunctions (approval moves it out of 'detected'/
  // 'negotiating'/'pending_hitl'), so the exaggeration caption can still cite
  // the real "before" number.
  const missBeforeRef = useRef<number | null>(null);
  const lastDecisionRef = useRef<typeof decisionOutcome>(null);
  const lastDecisionAtRef = useRef(0);

  if (decisionOutcome) {
    lastDecisionRef.current = decisionOutcome;
    lastDecisionAtRef.current = Date.now();
  }
  const effectiveDecision =
    decisionOutcome ??
    (Date.now() - lastDecisionAtRef.current < DECISION_HOLD_MS ? lastDecisionRef.current : null);

  const active = activeConjunctions.find(
    (c) =>
      c.status === 'detected' ||
      c.status === 'negotiating' ||
      c.status === 'pending_hitl'
  );
  const pair = effectiveDecision
    ? { satA: effectiveDecision.satA, satB: effectiveDecision.satB }
    : active
      ? { satA: active.sat_primary, satB: active.sat_secondary }
      : null;

  const eventId = active?.event_id ?? effectiveDecision?.eventId ?? null;
  if (active) missBeforeRef.current = active.miss_distance_km;

  // Fetch the real SGP4-propagated paths for this conjunction. Falls back to
  // the geometric arcs below if disabled, unavailable, or the request fails.
  useEffect(() => {
    if (TRAJECTORY_SOURCE !== 'backend' || !eventId) {
      setBackendArcs(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/conjunctions/${eventId}/paths`);
        if (!res.ok) throw new Error(`paths ${res.status}`);
        const data = await res.json();
        const toVecs = (pts: Array<{ lat: number; lon: number; alt_km: number }>) =>
          pts.map((p) => geodeticToThreeJS(p.lat, p.lon, p.alt_km));
        const points: Record<string, THREE.Vector3[]> = {};
        if (data.primary?.name) points[data.primary.name] = toVecs(data.primary.points);
        if (data.secondary?.name) points[data.secondary.name] = toVecs(data.secondary.points);
        const postManeuver = data.post_maneuver?.satellite
          ? {
              satellite: data.post_maneuver.satellite as string,
              points: toVecs(data.post_maneuver.points),
              maxSeparationKm: data.post_maneuver.max_separation_km ?? 0,
              missAfterKm: data.post_maneuver.post_maneuver_miss_km ?? null,
            }
          : null;
        if (!cancelled) setBackendArcs({ points, tcaIndex: data.tca_index ?? 0, postManeuver });
      } catch {
        if (!cancelled) setBackendArcs(null); // graceful fallback to geometric arcs
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const posOf = (name: string): THREE.Vector3 | null => {
    const s = Object.values(satellites).find((x) => x.name === name);
    if (!s || s.lat === undefined || s.lon === undefined || s.alt_km === undefined)
      return null;
    return geodeticToThreeJS(s.lat, s.lon, s.alt_km);
  };

  // Track recent positions (for velocity) and drive re-render during the bend.
  useFrame(() => {
    if (!pair) return;
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
    if (
      effectiveDecision?.decision === 'approve' &&
      Date.now() - effectiveDecision.timestamp < BEND_MS
    ) {
      force();
    }
  });

  if (!pair) return null;

  const posA = posOf(pair.satA);
  const posB = posOf(pair.satB);
  const velA = deriveVelocity(bufRef.current.get(pair.satA) ?? []);
  const velB = deriveVelocity(bufRef.current.get(pair.satB) ?? []);

  // Prefer the real backend-propagated arcs; otherwise fall back to the local
  // geometric great-circle arcs (which need current position + derived velocity).
  const beA = backendArcs?.points[pair.satA];
  const beB = backendArcs?.points[pair.satB];
  const usingBackend = !!(beA && beB && beA.length > 1 && beB.length > 1);

  let arcA: THREE.Vector3[];
  let arcB: THREE.Vector3[];
  if (usingBackend) {
    arcA = beA!;
    arcB = beB!;
  } else {
    if (!posA || !posB || !velA || !velB) return null; // hold off until motion is known
    arcA = getPredictedPath({ position: posA, velocity: velA, arcDeg: ARC_DEG, steps: STEPS });
    arcB = getPredictedPath({ position: posB, velocity: velB, arcDeg: ARC_DEG, steps: STEPS });
  }
  if (arcA.length === 0 || arcB.length === 0) return null;

  const approved = effectiveDecision?.decision === 'approve';
  const vetoed = effectiveDecision?.decision === 'veto';

  const ci = usingBackend
    ? Math.min(backendArcs!.tcaIndex, arcA.length - 1, arcB.length - 1)
    : closestApproachIndex(arcA, arcB);
  const markerPos = arcA[ci].clone().lerp(arcB[ci], 0.5);

  // A veto means the two craft actually hit at the marker: drawing the full
  // arcs past that point in their normal healthy colour reads as "nothing
  // happened". Cut each track off at the collision index and recolour it red
  // so the outcome is legible instead of two intact orbits sailing on.
  // Math.max(2, ...) so a collision at the very first sample (ci === 0) still
  // yields a 2-point segment -- drei's Line needs at least two points.
  const drawnArcA = vetoed ? arcA.slice(0, Math.max(2, ci + 1)) : arcA;
  const drawnArcB = vetoed ? arcB.slice(0, Math.max(2, ci + 1)) : arcB;

  const maneuverName = effectiveDecision?.satelliteName;
  const aIsManeuver = approved && maneuverName === pair.satA;
  const bIsManeuver = approved && maneuverName === pair.satB;

  let safeArc: THREE.Vector3[] | null = null;
  let ghostArc: THREE.Vector3[] | null = null;
  let exaggerationCaption: string | null = null;

  const pmData = backendArcs?.postManeuver;
  const originalManeuverTrack = aIsManeuver ? beA : bIsManeuver ? beB : null;
  const usingRealPostManeuver =
    approved &&
    usingBackend &&
    !!pmData &&
    pmData.satellite === maneuverName &&
    !!originalManeuverTrack &&
    pmData.points.length === originalManeuverTrack.length;

  if (approved && effectiveDecision) {
    if (usingRealPostManeuver && originalManeuverTrack) {
      const prog = Math.min(1, (Date.now() - effectiveDecision.timestamp) / BEND_MS);
      const ease = 1 - Math.pow(1 - prog, 3); // easeOutCubic
      // Real physics (SGP4 + along-track impulse), amplified for visibility:
      // draw at original + (post_maneuver - original) * exaggeration.
      safeArc = originalManeuverTrack.map((orig, i) => {
        const disp = pmData!.points[i].clone().sub(orig);
        return orig.clone().add(disp.multiplyScalar(SEPARATION_EXAGGERATION * ease));
      });

      const missBeforeKm = missBeforeRef.current ?? undefined;
      // The miss distance to the OTHER satellite -- must match the figure the
      // HITL and math panels show. Deliberately not maxSeparationKm, which is
      // how far this craft moved from its own original track (a larger number).
      const missAfterKm = pmData!.missAfterKm;
      if (missBeforeKm !== undefined && missAfterKm !== null) {
        exaggerationCaption = `maneuver separation ×${SEPARATION_EXAGGERATION} for visibility · true miss ${missBeforeKm.toFixed(2)} km → ${missAfterKm.toFixed(2)} km`;
      }
    } else {
      // Fallback: no real post-maneuver payload yet (or the geometric arcs are
      // in use) — approximate divergence, not labelled as exaggerated since
      // it isn't derived from real physics.
      const prog = Math.min(1, (Date.now() - effectiveDecision.timestamp) / BEND_MS);
      const ease = 1 - Math.pow(1 - prog, 3);
      const { phaseShiftDeg, radiusScale } = bentPathParams(
        effectiveDecision.burnDirection,
        effectiveDecision.deltaV
      );
      const mPos = aIsManeuver ? posA : posB;
      const mVel = aIsManeuver ? velA : velB;
      if (mPos && mVel) {
        safeArc = getPredictedPath({
          position: mPos,
          velocity: mVel,
          arcDeg: ARC_DEG,
          steps: STEPS,
          phaseShiftDeg: phaseShiftDeg * ease,
          radiusScale: 1 + (radiusScale - 1) * ease,
        });
      }
    }
    ghostArc = aIsManeuver ? arcA : bIsManeuver ? arcB : null;
  }

  // TCA countdown is only known while the event is still active (the backend
  // stamps the ISO time on the ConjunctionEvent, not on the decision outcome).
  let tcaMs: number | null = null;
  if (active) {
    const raw = active.tca_iso ?? active.tca;
    const parsed = raw ? Date.parse(raw) : NaN;
    tcaMs = Number.isNaN(parsed) ? null : parsed;
  }

  return (
    <group>
      {!aIsManeuver && (
        <ActiveArc
          points={drawnArcA}
          color={vetoed ? RED : approved ? AMBER : PRIMARY}
          approved={approved}
        />
      )}
      {!bIsManeuver && (
        <ActiveArc
          points={drawnArcB}
          color={vetoed ? RED : approved ? AMBER : SECONDARY}
          approved={approved}
        />
      )}

      {/* Full orbit-plane rings so the two planes read as planes, not squiggles. */}
      {posA && velA && <OrbitRing position={posA} velocityDir={velA} color={PRIMARY} />}
      {posB && velB && <OrbitRing position={posB} velocityDir={velB} color={SECONDARY} />}

      {/* APPROVE: faint ghost of the collision path + the green diverged path */}
      {approved && ghostArc && (
        <Line
          points={ghostArc}
          color={RED}
          lineWidth={2.4}
          dashed
          dashSize={0.035}
          gapSize={0.025}
          transparent
          opacity={0.45}
          depthWrite={false}
          depthTest={false}
          renderOrder={9}
        />
      )}
      {approved && safeArc && safeArc.length > 0 && (
        <>
          {/* Additive underlay, same trick as the threat arcs: this is the
              payoff of the whole run and it was rendering thinner and dimmer
              than the danger it resolves. */}
          <Line
            points={safeArc}
            color={GREEN}
            lineWidth={16}
            transparent
            opacity={0.16}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            depthTest={false}
            renderOrder={10}
          />
          <Line
            points={safeArc}
            color={GREEN}
            lineWidth={5.5}
            transparent
            opacity={1}
            depthWrite={false}
            depthTest={false}
            renderOrder={11}
          />
        </>
      )}
      {/* Held back while decisionOutcome is up: OutcomeOverlay's centre banner
          sits at roughly the same on-screen spot (CameraDirector keeps the
          pair centred) for its ~3.6s window. This caption carries real info
          (the exaggeration disclosure) so it still shows once the banner
          clears, for the rest of DECISION_HOLD_MS. */}
      {approved && safeArc && safeArc.length > 0 && exaggerationCaption && !decisionOutcome && (
        <Html position={safeArc[Math.floor(safeArc.length / 2)]} center zIndexRange={[5, 0]}>
          <div
            style={{
              background: 'rgba(10,15,30,0.8)',
              border: '1px solid #22c55e',
              color: '#c8ffd8',
              padding: '2px 6px',
              borderRadius: '3px',
              fontSize: '10px',
              fontFamily: 'var(--font-mono)',
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              transform: 'translateY(-20px)',
            }}
          >
            {exaggerationCaption}
          </div>
        </Html>
      )}

      {/* Closest-approach marker: only while a collision is still possible.
          Once vetoed, the explosion IS the marker -- a pulsing "tracking"
          ring at the same spot would read as still-live and undercut it. */}
      {!approved && !vetoed && <TCAMarker position={markerPos} color={RED} tcaMs={tcaMs} />}
    </group>
  );
};
