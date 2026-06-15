import React, { useRef, useReducer } from 'react';
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
} from './orbits';

const ARC_DEG = 65;
const STEPS = 72;
const BEND_MS = 1300; // duration of the post-maneuver path "swing"

const RED = '#ff4d4d';
const AMBER = '#ffb347';
const GREEN = '#22c55e';

export const ConjunctionPaths: React.FC = () => {
  const satellites = useSpaceStore((s) => s.satellites);
  const activeConjunctions = useSpaceStore((s) => s.activeConjunctions);
  const decisionOutcome = useSpaceStore((s) => s.decisionOutcome);

  const bufRef = useRef<Map<string, THREE.Vector3[]>>(new Map());
  const [, force] = useReducer((x) => x + 1, 0);

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
  if (!posA || !posB || !velA || !velB) return null; // hold off until motion is known

  const arcA = getPredictedPath({ position: posA, velocity: velA, arcDeg: ARC_DEG, steps: STEPS });
  const arcB = getPredictedPath({ position: posB, velocity: velB, arcDeg: ARC_DEG, steps: STEPS });
  if (arcA.length === 0 || arcB.length === 0) return null;

  const approved = decisionOutcome?.decision === 'approve';

  const ci = closestApproachIndex(arcA, arcB);
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
    const mPos = aIsManeuver ? posA : posB;
    const mVel = aIsManeuver ? velA : velB;
    safeArc = getPredictedPath({
      position: mPos,
      velocity: mVel,
      arcDeg: ARC_DEG,
      steps: STEPS,
      phaseShiftDeg: phaseShiftDeg * ease,
      radiusScale: 1 + (radiusScale - 1) * ease,
    });
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
