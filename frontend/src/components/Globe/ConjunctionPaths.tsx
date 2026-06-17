import React, { useRef, useReducer, useState, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import { useSpaceStore } from '../../store/useSpaceStore';
import { geodeticToThreeJS } from './SatelliteLayer';
import {
  deriveVelocity,
  getPredictedPath,
  bentPathParams,
  closestApproachIndex,
  TRAJECTORY_SOURCE,
} from './orbits';

const ARC_DEG = 65;
const STEPS = 72;
const BEND_MS = 1300; // duration of the post-maneuver path "swing"

const RED = '#ff4d4d';
const AMBER = '#ffb347';
const GREEN = '#22c55e';

interface BackendArcs {
  points: Record<string, THREE.Vector3[]>; // satellite name -> propagated path
  tcaIndex: number;
}

export const ConjunctionPaths: React.FC = () => {
  const satellites = useSpaceStore((s) => s.satellites);
  const activeConjunctions = useSpaceStore((s) => s.activeConjunctions);
  const decisionOutcome = useSpaceStore((s) => s.decisionOutcome);

  const bufRef = useRef<Map<string, THREE.Vector3[]>>(new Map());
  const [, force] = useReducer((x) => x + 1, 0);
  const [backendArcs, setBackendArcs] = useState<BackendArcs | null>(null);

  const active = activeConjunctions.find(
    (c) =>
      c.status === 'detected' ||
      c.status === 'negotiating' ||
      c.status === 'pending_hitl'
  );
  const pair = decisionOutcome
    ? { satA: decisionOutcome.satA, satB: decisionOutcome.satB }
    : active
      ? { satA: active.sat_primary, satB: active.sat_secondary }
      : null;

  const eventId = active?.event_id ?? decisionOutcome?.eventId ?? null;

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
        if (!cancelled) setBackendArcs({ points, tcaIndex: data.tca_index ?? 0 });
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
      decisionOutcome?.decision === 'approve' &&
      Date.now() - decisionOutcome.timestamp < BEND_MS
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

  const approved = decisionOutcome?.decision === 'approve';

  const ci = usingBackend
    ? Math.min(backendArcs!.tcaIndex, arcA.length - 1, arcB.length - 1)
    : closestApproachIndex(arcA, arcB);
  const markerPos = arcA[ci].clone().lerp(arcB[ci], 0.5);

  const maneuverName = decisionOutcome?.satelliteName;
  const aIsManeuver = approved && maneuverName === pair.satA;
  const bIsManeuver = approved && maneuverName === pair.satB;

  let safeArc: THREE.Vector3[] | null = null;
  let ghostArc: THREE.Vector3[] | null = null;
  if (approved && decisionOutcome) {
    const prog = Math.min(1, (Date.now() - decisionOutcome.timestamp) / BEND_MS);
    const ease = 1 - Math.pow(1 - prog, 3); // easeOutCubic
    const { phaseShiftDeg, radiusScale } = bentPathParams(
      decisionOutcome.burnDirection,
      decisionOutcome.deltaV
    );
    // Seed the projected post-burn path from the maneuvering satellite's real
    // motion, so the green divergence is anchored to its actual orbit.
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
    ghostArc = aIsManeuver ? arcA : bIsManeuver ? arcB : null;
  }

  return (
    <group>
      {!aIsManeuver && (
        <Line
          points={arcA}
          color={approved ? AMBER : RED}
          lineWidth={approved ? 1.6 : 2.2}
          transparent
          opacity={approved ? 0.5 : 0.9}
          depthWrite={false}
        />
      )}
      {!bIsManeuver && (
        <Line
          points={arcB}
          color={approved ? AMBER : RED}
          lineWidth={approved ? 1.6 : 2.2}
          transparent
          opacity={approved ? 0.5 : 0.9}
          depthWrite={false}
        />
      )}

      {/* APPROVE: faint ghost of the collision path + the green diverged path */}
      {approved && ghostArc && (
        <Line
          points={ghostArc}
          color={RED}
          lineWidth={1.4}
          transparent
          opacity={0.16}
          depthWrite={false}
        />
      )}
      {approved && safeArc && safeArc.length > 0 && (
        <Line
          points={safeArc}
          color={GREEN}
          lineWidth={2.6}
          transparent
          opacity={0.95}
          depthWrite={false}
        />
      )}

      {/* Closest-approach marker (only while a collision is still possible) */}
      {!approved && (
        <mesh position={markerPos}>
          <sphereGeometry args={[0.016, 16, 16]} />
          <meshBasicMaterial
            color={RED}
            transparent
            opacity={0.85}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      )}
    </group>
  );
};
