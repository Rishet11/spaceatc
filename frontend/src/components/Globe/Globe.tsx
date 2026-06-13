import React, { useMemo, useRef, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import { SatelliteLayer, geodeticToThreeJS } from './SatelliteLayer';
import { ConjunctionMarker } from './ConjunctionMarker';
import { CollisionExplosion } from './CollisionExplosion';
import { useSpaceStore } from '../../store/useSpaceStore';

const EARTH_RADIUS = 1.0;
const EARTH_TEXTURE_URL =
  'https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_atmos_2048.jpg';

// ---------------------------------------------------------------------------
// Earth sphere with texture
// ---------------------------------------------------------------------------
const Earth = () => {
  const texture = useMemo(
    () => new THREE.TextureLoader().load(EARTH_TEXTURE_URL),
    []
  );
  return (
    <mesh>
      <sphereGeometry args={[EARTH_RADIUS, 64, 64]} />
      <meshPhongMaterial map={texture} color="#ffffff" />
    </mesh>
  );
};

// ---------------------------------------------------------------------------
// Starfield — 1000 random stars, single draw call
// ---------------------------------------------------------------------------
function Starfield() {
  const positions = useMemo(() => {
    const pos = new Float32Array(3000);
    for (let i = 0; i < 1000; i++) {
      const r = 50 + Math.random() * 50;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.cos(phi);
      pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    return pos;
  }, []);

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={1000}
          array={positions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial size={0.1} color="#ffffff" sizeAttenuation />
    </points>
  );
}

// ---------------------------------------------------------------------------
// ConjunctionZone — pulsing red zone + line + distance label
// ---------------------------------------------------------------------------
function ConjunctionZone() {
  const activeConjunctions = useSpaceStore((s) => s.activeConjunctions);
  const satellites = useSpaceStore((s) => s.satellites);
  const resolvedEvent = useSpaceStore((s) => s.resolvedEvent);

  const activePair = activeConjunctions.find(
    (c) =>
      c.status === 'detected' ||
      c.status === 'negotiating' ||
      c.status === 'pending_hitl'
  );

  const satA_id = activePair ? activePair.sat_primary : resolvedEvent ? resolvedEvent.satA : null;
  const satB_id = activePair ? activePair.sat_secondary : resolvedEvent ? resolvedEvent.satB : null;

  const satA = satA_id ? Object.values(satellites).find((s) => s.name === satA_id) : null;
  const satB = satB_id ? Object.values(satellites).find((s) => s.name === satB_id) : null;

  const posA = satA?.lat !== undefined && satA?.lon !== undefined && satA?.alt_km !== undefined
      ? geodeticToThreeJS(satA.lat, satA.lon, satA.alt_km)
      : null;
  const posB = satB?.lat !== undefined && satB?.lon !== undefined && satB?.alt_km !== undefined
      ? geodeticToThreeJS(satB.lat, satB.lon, satB.alt_km)
      : null;

  const sphereRef = useRef<THREE.Mesh>(null);
  const lineRef = useRef<any>(null);

  const [isResolving, setIsResolving] = React.useState(false);

  useEffect(() => {
    if (resolvedEvent) {
      setIsResolving(true);
      const timer = setTimeout(() => setIsResolving(false), 3000);
      return () => clearTimeout(timer);
    } else {
      setIsResolving(false);
    }
  }, [resolvedEvent]);

  useFrame((state) => {
    if (!sphereRef.current || !posA || !posB) return;

    const mid = posA.clone().add(posB).multiplyScalar(0.5);
    sphereRef.current.position.copy(mid);

    let currentElapsed = 0;
    if (resolvedEvent) {
      currentElapsed = (Date.now() - resolvedEvent.timestamp) / 1000;
    }

    if (resolvedEvent && currentElapsed < 3) {
      const sphereOp = Math.max(0, 0.6 - currentElapsed * 0.6);
      (sphereRef.current.material as THREE.MeshBasicMaterial).opacity = sphereOp;
      
      if (lineRef.current) {
         lineRef.current.material.color.set('#22c55e');
         const lineOp = Math.max(0, 0.8 - (currentElapsed / 2.0) * 0.8);
         lineRef.current.material.opacity = lineOp;
      }
    } else {
      const pulse = Math.sin(state.clock.elapsedTime * 4) * 0.3 + 1;
      sphereRef.current.scale.setScalar(pulse);
      (sphereRef.current.material as THREE.MeshBasicMaterial).opacity = 0.6;
      if (lineRef.current) {
         lineRef.current.material.color.set('#ef4444');
         lineRef.current.material.opacity = 0.8;
      }
    }
  });

  if (!satA_id || !posA || !posB) return null;
  if (!activePair && !isResolving) return null;

  const midpoint = posA.clone().add(posB).multiplyScalar(0.5);
  const dist = posA.distanceTo(posB);

  return (
    <>
      <mesh ref={sphereRef} position={midpoint}>
        <sphereGeometry args={[0.02, 8, 8]} />
        <meshBasicMaterial
          color="#ef4444"
          transparent
          opacity={0.6}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
        <pointLight color="#ef4444" intensity={3} distance={2} />
      </mesh>

      <Line
        ref={lineRef}
        points={[
          [posA.x, posA.y, posA.z],
          [posB.x, posB.y, posB.z],
        ]}
        color="#ef4444"
        lineWidth={2}
        transparent
        opacity={0.8}
      />

      {activePair && (
        <Html position={midpoint} center>
          <div
            style={{
              background: 'rgba(239,68,68,0.9)',
              color: 'white',
              padding: '4px 8px',
              borderRadius: '4px',
              fontSize: '12px',
              fontFamily: 'monospace',
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              boxShadow: '0 0 12px rgba(239,68,68,0.5)',
            }}
          >
            ⚠ {(dist * 6371).toFixed(1)} km — COLLISION COURSE
          </div>
        </Html>
      )}

      {isResolving && (
        <Html position={midpoint} center>
          <div style={{
             fontSize: '2rem',
             color: '#22c55e',
             fontWeight: 'bold',
             fontFamily: 'monospace',
             whiteSpace: 'nowrap',
             textShadow: '0 0 20px #22c55e',
             animation: 'fadeOut 3s forwards',
             pointerEvents: 'none'
          }}>
            ✓ CONJUNCTION RESOLVED
          </div>
          <style>{`
            @keyframes fadeOut {
              0% { opacity: 0; transform: scale(0.8); }
              10% { opacity: 1; transform: scale(1.1); }
              20% { opacity: 1; transform: scale(1); }
              80% { opacity: 1; }
              100% { opacity: 0; }
            }
          `}</style>
        </Html>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// CameraController — auto-zoom toward conjunction midpoint
// ---------------------------------------------------------------------------
function CameraController() {
  const { camera } = useThree();
  const activeConjunctions = useSpaceStore((s) => s.activeConjunctions);

  const activePair = activeConjunctions.find(
    (c) =>
      c.status === 'detected' ||
      c.status === 'negotiating' ||
      c.status === 'pending_hitl'
  );

  useFrame(() => {
    if (activePair) {
      // Zoom closer
      const target = new THREE.Vector3(0, 0, 3.0);
      camera.position.lerp(target, 0.02);
    } else {
      // Smoothly return to original distance [0,0,4]
      const target = new THREE.Vector3(0, 0, 4.0);
      camera.position.lerp(target, 0.015);
    }
  });

  return null;
}

// ---------------------------------------------------------------------------
// Globe — main component
// ---------------------------------------------------------------------------
export const Globe: React.FC = () => {
  return (
    <div className="absolute inset-0 bg-black">
      <Canvas
        camera={{ position: [0, 0, 4.0], fov: 45 }}
        style={{ width: '100%', height: '100%' }}
      >
        <ambientLight intensity={0.2} />
        <directionalLight position={[5, 3, 5]} intensity={1.5} />

        <Starfield />
        <Earth />
        <SatelliteLayer />
        <ConjunctionMarker />
        <ConjunctionZone />
        <CollisionExplosion />
        <CameraController />

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
