import React, { useMemo } from 'react';
import * as THREE from 'three';
import { Line } from '@react-three/drei';
import { getOrbitRingPoints } from './orbits';

interface OrbitRingProps {
  position: THREE.Vector3;
  velocityDir: THREE.Vector3;
  color: string;
}

// Draws the full closed orbit plane for a satellite so two conjuncting
// satellites' planes read as PLANES (and visibly cross), not squiggles.
export const OrbitRing: React.FC<OrbitRingProps> = ({ position, velocityDir, color }) => {
  const points = useMemo(
    () => getOrbitRingPoints(position, velocityDir, 128),
    // Re-derive only when the plane actually changes meaningfully, not every
    // frame — position/velocityDir are already stable-ish per render.
    [position.x, position.y, position.z, velocityDir.x, velocityDir.y, velocityDir.z]
  );

  if (points.length === 0) return null;

  return (
    <Line
      points={points}
      color={color}
      lineWidth={1.5}
      transparent
      opacity={0.22}
      depthWrite={false}
    />
  );
};
