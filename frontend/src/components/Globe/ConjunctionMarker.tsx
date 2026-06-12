import React, { useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useSpaceStore } from '../../store/useSpaceStore';

export const ConjunctionMarker: React.FC = () => {
  const activeConjunctions = useSpaceStore(state => state.activeConjunctions);
  const satellites = useSpaceStore(state => state.satellites);
  const groupRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (groupRef.current) {
      const scale = 1 + Math.sin(clock.elapsedTime * 4) * 0.2;
      groupRef.current.children.forEach(c => c.scale.set(scale, scale, scale));
    }
  });

  const getPos = (lat?: number, lon?: number, alt?: number) => {
    if (lat === undefined || lon === undefined || alt === undefined) return null;
    const latRad = lat * (Math.PI / 180);
    const lonRad = lon * (Math.PI / 180);
    const r = 1.0 + (alt / 6371);
    return new THREE.Vector3(
      r * Math.cos(latRad) * Math.cos(lonRad),
      r * Math.sin(latRad),
      r * Math.cos(latRad) * Math.sin(lonRad)
    );
  };

  return (
    <group ref={groupRef}>
      {activeConjunctions.filter(c => c.status === 'detected' || c.status === 'negotiating' || c.status === 'pending_hitl').map(c => {
        const sat1 = Object.values(satellites).find(s => s.name === c.sat_primary);
        const sat2 = Object.values(satellites).find(s => s.name === c.sat_secondary);
        
        const v1 = getPos(sat1?.lat, sat1?.lon, sat1?.alt_km);
        const v2 = getPos(sat2?.lat, sat2?.lon, sat2?.alt_km);

        if (v1 && v2) {
          const midpoint = v1.clone().lerp(v2, 0.5);
          return (
            <mesh key={c.event_id} position={midpoint}>
              <sphereGeometry args={[0.02, 16, 16]} />
              <meshBasicMaterial color="#ef4444" transparent opacity={0.8} />
              <pointLight color="#ef4444" intensity={2} distance={2} />
            </mesh>
          );
        }
        return null;
      })}
    </group>
  );
};
