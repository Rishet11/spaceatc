import React, { useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useSpaceStore } from '../../store/useSpaceStore';

interface ExplosionData {
  id: string;
  position: THREE.Vector3;
  startTime: number;
}

export const CollisionExplosion: React.FC = () => {
  const activeConjunctions = useSpaceStore(state => state.activeConjunctions);
  const satellites = useSpaceStore(state => state.satellites);
  const addDestroyedSatellites = useSpaceStore(state => state.addDestroyedSatellites);
  
  const [explosions, setExplosions] = useState<ExplosionData[]>([]);
  const explodedEvents = useRef(new Set<string>());

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

  useFrame(({ clock }) => {
    let triggered = false;
    const newExplosions: ExplosionData[] = [];

    // 1. Detect new explosions
    activeConjunctions.forEach(c => {
      // Only check if it's unresolved
      if (c.status === 'detected' || c.status === 'negotiating' || c.status === 'pending_hitl') {
        if (explodedEvents.current.has(c.event_id)) return;

        const sat1 = Object.values(satellites).find(s => s.name === c.sat_primary);
        const sat2 = Object.values(satellites).find(s => s.name === c.sat_secondary);

        const v1 = getPos(sat1?.lat, sat1?.lon, sat1?.alt_km);
        const v2 = getPos(sat2?.lat, sat2?.lon, sat2?.alt_km);

        if (v1 && v2) {
          const distance = v1.distanceTo(v2);
          // 0.008 units is approx 50km
          if (distance < 0.008) {
            explodedEvents.current.add(c.event_id);
            const midpoint = v1.clone().lerp(v2, 0.5);
            newExplosions.push({
              id: c.event_id,
              position: midpoint,
              startTime: clock.elapsedTime
            });
            triggered = true;
            // Mark satellites as destroyed to stop rendering them
            addDestroyedSatellites([c.sat_primary, c.sat_secondary]);
          }
        }
      }
    });

    if (triggered) {
      setExplosions(prev => [...prev, ...newExplosions]);
    }
  });

  return (
    <group>
      {explosions.map(exp => (
        <ExplosionParticle key={exp.id} data={exp} />
      ))}
    </group>
  );
};

const ExplosionParticle: React.FC<{ data: ExplosionData }> = ({ data }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);
  const lightRef = useRef<THREE.PointLight>(null);

  useFrame(({ clock }) => {
    const elapsed = clock.elapsedTime - data.startTime;
    const duration = 3.0; // Explosion lasts 3 seconds

    if (elapsed < duration && meshRef.current && materialRef.current && lightRef.current) {
      // Rapidly scale up, then slowly grow
      const scale = 1 + Math.pow(elapsed * 5, 0.5);
      meshRef.current.scale.set(scale, scale, scale);
      
      // Fade out opacity
      const opacity = Math.max(0, 1 - (elapsed / duration));
      materialRef.current.opacity = opacity;
      lightRef.current.intensity = opacity * 5;
    }
  });

  return (
    <mesh ref={meshRef} position={data.position}>
      <sphereGeometry args={[0.01, 32, 32]} />
      <meshBasicMaterial 
        ref={materialRef} 
        color="#ff5500" 
        transparent 
        opacity={1} 
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
      <pointLight ref={lightRef} color="#ff3300" intensity={5} distance={5} />
    </mesh>
  );
};
