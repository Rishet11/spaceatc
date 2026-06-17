import * as THREE from 'three';

// 'backend' = render the real SGP4-propagated conjunction paths fetched from
// /api/conjunctions/{id}/paths. 'sim' = the local geometric great-circle arcs
// (deriveVelocity + getPredictedPath), used as the offline/error fallback.
export const TRAJECTORY_SOURCE: 'sim' | 'backend' = 'backend';

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
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  arcDeg?: number;
  steps?: number;
  phaseShiftDeg?: number;
  radiusScale?: number;
}

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

export function bentPathParams(
  burnDirection: 'prograde' | 'retrograde' | 'radial',
  deltaV_ms: number
): { phaseShiftDeg: number; radiusScale: number } {
  // Subtle along-track shift: legible separation without a theatrical orbit
  // swing. The real signal that the maneuver worked is the collision-probability
  // drop shown in the HITL panel and outcome readout, not a big visual jump.
  const mag = Math.min(5, Math.max(2, deltaV_ms * 18)); // degrees of along-track shift
  if (burnDirection === 'prograde') return { phaseShiftDeg: mag, radiusScale: 1 };
  if (burnDirection === 'retrograde') return { phaseShiftDeg: -mag, radiusScale: 1 };
  return { phaseShiftDeg: 0, radiusScale: 1.02 }; // radial: nudge to a slightly higher shell
}

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
