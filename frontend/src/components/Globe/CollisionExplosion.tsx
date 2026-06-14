import React, { useRef, useState, useMemo } from 'react';
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
  const decisionOutcome = useSpaceStore(state => state.decisionOutcome);
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

    // 1. A human VETO is an immediate, guaranteed catastrophe — detonate at the
    //    pair's midpoint right now, regardless of how far apart they currently are.
    if (
      decisionOutcome &&
      decisionOutcome.decision === 'veto' &&
      !explodedEvents.current.has(decisionOutcome.eventId)
    ) {
      const s1 = Object.values(satellites).find(s => s.name === decisionOutcome.satA);
      const s2 = Object.values(satellites).find(s => s.name === decisionOutcome.satB);
      const v1 = getPos(s1?.lat, s1?.lon, s1?.alt_km);
      const v2 = getPos(s2?.lat, s2?.lon, s2?.alt_km);
      const center = v1 && v2 ? v1.clone().lerp(v2, 0.5) : v1 ?? v2;

      if (center) {
        explodedEvents.current.add(decisionOutcome.eventId);
        newExplosions.push({
          id: decisionOutcome.eventId,
          position: center,
          startTime: clock.elapsedTime,
        });
        triggered = true;
        addDestroyedSatellites([decisionOutcome.satA, decisionOutcome.satB]);
      }
    }

    // 2. Fallback: organic collision when an unresolved pair physically drifts together.
    activeConjunctions.forEach(c => {
      if (c.status === 'detected' || c.status === 'negotiating' || c.status === 'pending_hitl' || c.status === 'vetoed') {
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

const DEBRIS_COUNT = 70;

const ExplosionParticle: React.FC<{ data: ExplosionData }> = ({ data }) => {
  const coreRef = useRef<THREE.Mesh>(null);
  const coreMat = useRef<THREE.MeshBasicMaterial>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const ringMat = useRef<THREE.MeshBasicMaterial>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const debrisRef = useRef<THREE.Points>(null);

  // Random outward velocity for each debris fragment.
  const debrisVel = useMemo(() => {
    const arr: THREE.Vector3[] = [];
    for (let i = 0; i < DEBRIS_COUNT; i++) {
      arr.push(
        new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
          .normalize()
          .multiplyScalar(0.015 + Math.random() * 0.05)
      );
    }
    return arr;
  }, []);

  const debrisGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DEBRIS_COUNT * 3), 3));
    return g;
  }, []);

  useFrame(({ clock }) => {
    const elapsed = clock.elapsedTime - data.startTime;
    const duration = 3.5;
    const k = Math.min(elapsed / duration, 1);

    // Core flash — fast bloom, then fade.
    if (coreRef.current && coreMat.current) {
      const scale = 1 + Math.pow(elapsed * 6, 0.5);
      coreRef.current.scale.setScalar(scale);
      coreMat.current.opacity = Math.max(0, 1 - k * 1.4);
    }

    // Expanding shockwave ring.
    if (ringRef.current && ringMat.current) {
      ringRef.current.scale.setScalar(1 + elapsed * 16);
      ringMat.current.opacity = Math.max(0, 0.85 - k * 0.85);
    }

    // Flash light.
    if (lightRef.current) {
      lightRef.current.intensity = Math.max(0, 9 * (1 - k));
    }

    // Debris fragments fly outward.
    if (debrisRef.current) {
      const pos = debrisGeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < debrisVel.length; i++) {
        pos.setXYZ(
          i,
          debrisVel[i].x * elapsed * 9,
          debrisVel[i].y * elapsed * 9,
          debrisVel[i].z * elapsed * 9
        );
      }
      pos.needsUpdate = true;
      (debrisRef.current.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - k);
    }
  });

  return (
    <group position={data.position}>
      {/* Core fireball */}
      <mesh ref={coreRef}>
        <sphereGeometry args={[0.012, 32, 32]} />
        <meshBasicMaterial
          ref={coreMat}
          color="#ffdd55"
          transparent
          opacity={1}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      {/* Shockwave ring */}
      <mesh ref={ringRef} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.012, 0.017, 48]} />
        <meshBasicMaterial
          ref={ringMat}
          color="#ff7700"
          transparent
          opacity={0.85}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      {/* Debris field */}
      <points ref={debrisRef} geometry={debrisGeo}>
        <pointsMaterial
          size={0.006}
          color="#ff5500"
          transparent
          opacity={1}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          sizeAttenuation
        />
      </points>

      <pointLight ref={lightRef} color="#ff3300" intensity={9} distance={6} />
    </group>
  );
};
