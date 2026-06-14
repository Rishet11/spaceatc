import * as THREE from 'three';

/**
 * Orbital-path trajectory abstraction.
 *
 * Phase 1 ('sim'): derives an approximate *circular* orbit arc from a satellite's
 * instantaneous scene position + a velocity direction (recovered from recent
 * motion). Earth is centered at the origin with radius 1.0 scene unit, matching
 * `geodeticToThreeJS` in SatelliteLayer.tsx.
 *
 * Phase 3 ('backend'): swap `getPredictedPath` to consume real SGP4 samples from
 * a backend /api/trajectory endpoint and feed the same Vector3[] to the renderer.
 * Nothing else needs to change.
 */
export const TRAJECTORY_SOURCE: 'sim' | 'backend' = 'sim';

/**
 * Recover a normalized velocity *direction* from a satellite's recent positions
 * (newest last). Averages the last two deltas to smooth the ~2s WebSocket cadence.
 * Returns null when there isn't enough motion yet to be reliable.
 */
export function deriveVelocity(points: THREE.Vector3[]): THREE.Vector3 | null {
  const n = points.length;
  if (n < 2) return null;
  let v: THREE.Vector3;
  if (n === 2) {
    v = points[n - 1].clone().sub(points[n - 2]);
  } else {
    const d1 = points[n - 1].clone().sub(points[n - 2]);
    const d2 = points[n - 2].clone().sub(points[n - 3]);
    v = d1.add(d2).multiplyScalar(0.5);
  }
  return v.lengthSq() > 1e-12 ? v.normalize() : null;
}

export interface PredictedPathOptions {
  position: THREE.Vector3;        // current scene position
  velocity: THREE.Vector3;        // normalized direction of travel
  arcDeg?: number;                // how far forward to sweep
  steps?: number;                 // segment count (smoothness)
  phaseShiftDeg?: number;         // along-track offset (maneuver: ahead/behind)
  radiusScale?: number;           // altitude scale (maneuver: raise/lower shell)
}

/**
 * Sweep the position vector around the orbit-plane normal (N = P × V) to trace a
 * forward circular arc. A positive sweep follows the direction of travel (verified
 * analytically: d/dθ at θ=0 is parallel to V for a tangential velocity).
 *
 * `phaseShiftDeg` advances/retards the satellite along that same orbit (prograde /
 * retrograde burn); `radiusScale` lifts/drops the whole arc to a separated shell
 * (radial burn). Both are how the post-maneuver path is drawn diverging.
 */
export function getPredictedPath({
  position,
  velocity,
  arcDeg = 60,
  steps = 64,
  phaseShiftDeg = 0,
  radiusScale = 1,
}: PredictedPathOptions): THREE.Vector3[] {
  const normal = position.clone().cross(velocity);
  if (normal.lengthSq() < 1e-10) return []; // velocity ∥ position — can't define a plane
  normal.normalize();

  const r = position.length() * radiusScale;
  const start = position
    .clone()
    .applyAxisAngle(normal, THREE.MathUtils.degToRad(phaseShiftDeg))
    .setLength(r);

  const arc = THREE.MathUtils.degToRad(arcDeg);
  const pts: THREE.Vector3[] = [];
  for (let k = 0; k <= steps; k++) {
    const theta = arc * (k / steps);
    pts.push(start.clone().applyAxisAngle(normal, theta).setLength(r));
  }
  return pts;
}

/**
 * Map an approved proposal to how its predicted path should deform.
 * Magnitudes are deliberately exaggerated for on-screen legibility — a real
 * ~0.1 m/s burn moves the path imperceptibly — and the UI labels them as such.
 */
export function bentPathParams(
  burnDirection: 'prograde' | 'retrograde' | 'radial',
  deltaV_ms: number
): { phaseShiftDeg: number; radiusScale: number } {
  const mag = Math.min(18, Math.max(7, deltaV_ms * 60)); // degrees of along-track shift
  if (burnDirection === 'prograde') return { phaseShiftDeg: mag, radiusScale: 1 };
  if (burnDirection === 'retrograde') return { phaseShiftDeg: -mag, radiusScale: 1 };
  return { phaseShiftDeg: 0, radiusScale: 1.06 }; // radial: raise to a higher shell
}

/** Index along two equal-length sampled arcs where they come closest (visual TCA). */
export function closestApproachIndex(a: THREE.Vector3[], b: THREE.Vector3[]): number {
  const len = Math.min(a.length, b.length);
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < len; i++) {
    const d = a[i].distanceToSquared(b[i]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
