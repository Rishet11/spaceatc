import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useSpaceStore } from '../../store/useSpaceStore';

export const SatelliteLayer: React.FC = () => {
  const satellites = useSpaceStore(state => state.satellites);
  const satsArray = Object.values(satellites).filter(s => s.lat !== undefined && s.lon !== undefined && s.alt_km !== undefined);
  
  const normalSats = satsArray.filter(s => !s.is_highlighted && !s.name?.includes("DEMO"));
  const highlightSats = satsArray.filter(s => s.is_highlighted || s.name?.includes("DEMO"));

  const normalMeshRef = useRef<THREE.InstancedMesh>(null);
  const highlightMeshRef = useRef<THREE.InstancedMesh>(null);

  useEffect(() => {
    const updateMesh = (mesh: THREE.InstancedMesh | null, list: typeof satsArray) => {
      if (!mesh) return;
      const dummy = new THREE.Object3D();
      list.forEach((sat, i) => {
        const latRad = sat.lat! * (Math.PI / 180);
        const lonRad = sat.lon! * (Math.PI / 180);
        const r = 1.0 + (sat.alt_km! / 6371);
        
        const x = r * Math.cos(latRad) * Math.cos(lonRad);
        const y = r * Math.sin(latRad);
        const z = r * Math.cos(latRad) * Math.sin(lonRad);
        
        dummy.position.set(x, y, z);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    };

    updateMesh(normalMeshRef.current, normalSats);
    updateMesh(highlightMeshRef.current, highlightSats);
  }, [normalSats, highlightSats]);

  return (
    <>
      {normalSats.length > 0 && (
        <instancedMesh ref={normalMeshRef} args={[null as any, null as any, normalSats.length]}>
          <sphereGeometry args={[0.003, 8, 8]} />
          <meshBasicMaterial color="#ffffff" />
        </instancedMesh>
      )}
      {highlightSats.length > 0 && (
        <instancedMesh ref={highlightMeshRef} args={[null as any, null as any, highlightSats.length]}>
          <sphereGeometry args={[0.008, 16, 16]} />
          <meshBasicMaterial color="#fbbf24" />
        </instancedMesh>
      )}
    </>
  );
};
