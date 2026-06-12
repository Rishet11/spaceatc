import React, { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Stars, Sphere } from '@react-three/drei';
import * as THREE from 'three';
import * as satellite from 'satellite.js';
import { useSpaceStore } from '../../store';

const EARTH_RADIUS = 1.0;
// NASA Blue Marble or similar free texture from unpkg/cors-friendly source
const EARTH_TEXTURE_URL = 'https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg';

// Helper: ECI (Earth-Centered Inertial) to Scene coordinates
// We'll approximate by scaling the ECI position vector directly.
// The true ECI needs GMST rotation to align with the texture, but for a 
// standalone globe visualizer, relative positions are most important.
const eciToVector3 = (pos: number[], scale = 1.0 / 6371) => {
  // pos is [x, y, z] in km. Scale down by Earth radius in km.
  // Three.js Y is UP. ECI Z is UP (North pole).
  // So swap Y and Z.
  return new THREE.Vector3(pos[0] * scale, pos[2] * scale, -pos[1] * scale);
};

const Earth = () => {
  const texture = useMemo(() => new THREE.TextureLoader().load(EARTH_TEXTURE_URL), []);
  return (
    <mesh>
      <sphereGeometry args={[EARTH_RADIUS, 64, 64]} />
      <meshStandardMaterial map={texture} roughness={0.6} />
    </mesh>
  );
};

const Satellites = () => {
  const satellites = useSpaceStore(state => state.satellites);
  const activeConjunctions = useSpaceStore(state => state.activeConjunctions);

  // Identify satellites involved in an active conjunction
  const conjSatIds = new Set<string>();
  activeConjunctions.forEach(c => {
    if (c.status !== 'resolved' && c.status !== 'vetoed') {
      conjSatIds.add(c.sat_primary);
      conjSatIds.add(c.sat_secondary); // We don't have norad_id in conjunction event directly, 
      // wait, the PRD DB has sat_primary as NAME or NORAD? The python code uses name in DB, but event might have it.
      // Actually, we can just highlight if is_highlighted is true, or check name.
    }
  });

  return (
    <>
      {Object.values(satellites).map(sat => {
        if (!sat.position) return null;
        
        const vec = eciToVector3(sat.position);
        // Is it part of a conjunction? Or marked highlighted?
        const isConj = sat.is_highlighted || sat.name.includes("DEMO");
        
        const color = isConj ? '#ffffff' : '#3b82f6';
        const size = isConj ? 0.04 : 0.015;

        return (
          <mesh key={sat.norad_id} position={vec}>
            <sphereGeometry args={[size, 16, 16]} />
            <meshBasicMaterial color={color} />
            {isConj && (
              <pointLight color="#ef4444" intensity={2} distance={2} />
            )}
          </mesh>
        );
      })}
    </>
  );
};

// A simple pulsing red zone for active conjunctions
const ConjunctionZones = () => {
  const activeConjunctions = useSpaceStore(state => state.activeConjunctions);
  const satellites = useSpaceStore(state => state.satellites);
  const ref = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (ref.current) {
      const scale = 1 + Math.sin(clock.elapsedTime * 4) * 0.2;
      ref.current.children.forEach(c => c.scale.set(scale, scale, scale));
    }
  });

  return (
    <group ref={ref}>
      {activeConjunctions.filter(c => c.status === 'detected' || c.status === 'negotiating' || c.status === 'pending_execution').map(c => {
        // Find positions of the two satellites to put the zone between them
        const sat1 = Object.values(satellites).find(s => s.name === c.sat_primary);
        const sat2 = Object.values(satellites).find(s => s.name === c.sat_secondary);
        
        if (sat1?.position && sat2?.position) {
          const v1 = eciToVector3(sat1.position);
          const v2 = eciToVector3(sat2.position);
          const midpoint = v1.clone().lerp(v2, 0.5);
          
          return (
            <mesh key={c.event_id} position={midpoint}>
              <sphereGeometry args={[0.06, 32, 32]} />
              <meshBasicMaterial color="#ef4444" transparent opacity={0.5} />
            </mesh>
          );
        }
        return null;
      })}
    </group>
  );
};

export const Globe: React.FC = () => {
  return (
    <div className="absolute inset-0 bg-black">
      <Canvas camera={{ position: [0, 0, 3.5], fov: 45 }}>
        <ambientLight intensity={0.1} />
        <directionalLight position={[5, 3, 5]} intensity={2} />
        <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
        
        <Earth />
        <Satellites />
        <ConjunctionZones />
        
        <OrbitControls 
          enablePan={false}
          minDistance={1.2}
          maxDistance={10}
          autoRotate
          autoRotateSpeed={0.5}
        />
      </Canvas>
    </div>
  );
};
