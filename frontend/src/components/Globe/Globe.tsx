import React, { useMemo, useRef, useEffect, Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Html, Line } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';
import { SatelliteLayer, geodeticToThreeJS } from './SatelliteLayer';
import { ConjunctionPaths } from './ConjunctionPaths';
import { CollisionExplosion } from './CollisionExplosion';
import { CameraDirector } from './CameraDirector';
import { EarthGlobe, Atmosphere, Clouds } from './EarthMaterial';
import { useSpaceStore } from '../../store/useSpaceStore';

// Starfield — 1000 random stars, single draw call
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
          args={[positions, 3]}
          count={1000}
          array={positions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial size={0.1} color="#ffffff" sizeAttenuation />
    </points>
  );
}

// ConjunctionZone — pulsing red zone + line + distance label
function ConjunctionZone() {
  const activeConjunctions = useSpaceStore((s) => s.activeConjunctions);
  const satellites = useSpaceStore((s) => s.satellites);
  const resolvedEvent = useSpaceStore((s) => s.resolvedEvent);

  // The REST poll's ConjunctionEvent.status doesn't always flip away from
  // 'detected' the instant a decision lands, which otherwise pinned this
  // component on the stale pre-maneuver "MISS AT TCA" label forever.
  // decisionOutcome would be the obvious signal but OutcomeOverlay.tsx clears
  // it from the store only 3.6s after it's set, well before the backend's
  // 'maneuver_executed' broadcast (and this poll) typically catches up —
  // so match on resolvedEvent's satellite pair instead, which has no such
  // short timeout.
  const activePair = activeConjunctions.find(
    (c) =>
      (c.status === 'detected' ||
        c.status === 'negotiating' ||
        c.status === 'pending_hitl') &&
      !(
        resolvedEvent &&
        ((c.sat_primary === resolvedEvent.satA && c.sat_secondary === resolvedEvent.satB) ||
          (c.sat_primary === resolvedEvent.satB && c.sat_secondary === resolvedEvent.satA))
      )
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
    if (activePair) {
      // A new conjunction is active — don't show the stale "resolved" visual.
      setIsResolving(false);
      return;
    }
    if (resolvedEvent) {
      setIsResolving(true);
      const timer = setTimeout(() => setIsResolving(false), 3000);
      return () => clearTimeout(timer);
    } else {
      setIsResolving(false);
    }
  }, [resolvedEvent, activePair]);

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

      {activePair && !isResolving && (
        <Html position={midpoint} center zIndexRange={[10, 0]}>
          <div
            style={{
              background: 'rgba(239,68,68,0.9)',
              color: 'white',
              padding: '4px 8px',
              borderRadius: '4px',
              fontSize: '12px',
              fontFamily: 'var(--font-mono)',
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              boxShadow: '0 0 12px rgba(239,68,68,0.5)',
            }}
          >
            {/* This label used to show the CURRENT separation next to the
                words "COLLISION COURSE", which reads as several thousand km
                well before TCA. The miss distance at closest approach is the
                number that actually matters, and the backend already sends it. */}
            {activePair.miss_distance_km.toFixed(3)} km MISS AT TCA
          </div>
        </Html>
      )}

      {/* A "CONJUNCTION RESOLVED" watermark used to render here, anchored at
          this same midpoint, once decisionOutcome had cleared -- by which
          time OutcomeOverlay's centre banner (COLLISION AVOIDED / MANEUVER
          EXECUTED) and the MathPanel
          resolved card already say the same thing -- and it collided with
          ConjunctionPaths.tsx's exaggeration-factor caption, which anchors at
          the same point and carries required disclosure text that must stay
          readable. Removed rather than repositioned: it was redundant with
          the other two, and the caption is the one that has to win the
          fight for this spot. */}
    </>
  );
}

// Globe — main component
export const Globe: React.FC = () => {
  const pipelineStage = useSpaceStore((s) => s.pipelineStage);

  // Rotation is only held still while the camera is actively framing a
  // conjunction for a decision ('awaiting'); a resolved/collided event
  // hanging around in the store must not freeze the globe forever.
  const eventActive = pipelineStage === 'awaiting';

  const controlsRef = useRef<any>(null);

  return (
    <div className="absolute inset-0 bg-black">
      <Canvas
        camera={{ position: [0, 0, 4.0], fov: 45 }}
        style={{ width: '100%', height: '100%' }}
      >
        <ambientLight intensity={0.15} />
        <directionalLight position={[5, 3, 5]} intensity={1.5} />

        <Starfield />
        <Suspense fallback={null}>
          <EarthGlobe />
          <Clouds />
        </Suspense>
        <Atmosphere />
        <SatelliteLayer />
        <ConjunctionPaths />
        <ConjunctionZone />
        <CollisionExplosion />
        <CameraDirector controlsRef={controlsRef} />

        <OrbitControls
          ref={controlsRef}
          enablePan={false}
          minDistance={1.2}
          maxDistance={10}
          autoRotate={!eventActive}
          autoRotateSpeed={0.3}
        />

        <EffectComposer>
          <Bloom luminanceThreshold={0.8} intensity={0.6} mipmapBlur />
        </EffectComposer>
      </Canvas>
    </div>
  );
};
