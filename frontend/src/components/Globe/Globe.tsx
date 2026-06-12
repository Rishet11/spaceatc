import React, { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import * as THREE from 'three';
import { SatelliteLayer } from './SatelliteLayer';
import { ConjunctionMarker } from './ConjunctionMarker';

const EARTH_RADIUS = 1.0;
const EARTH_TEXTURE_URL = 'https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg';

const Earth = () => {
  const texture = useMemo(() => new THREE.TextureLoader().load(EARTH_TEXTURE_URL), []);
  return (
    <mesh>
      <sphereGeometry args={[EARTH_RADIUS, 64, 64]} />
      <meshPhongMaterial map={texture} color="#1a3a5c" />
    </mesh>
  );
};

export const Globe: React.FC = () => {
  return (
    <div className="absolute inset-0 bg-black">
      <Canvas camera={{ position: [0, 0, 3.5], fov: 45 }}>
        <ambientLight intensity={0.2} />
        <directionalLight position={[5, 3, 5]} intensity={1.5} />
        <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
        
        <Earth />
        <SatelliteLayer />
        <ConjunctionMarker />
        
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
