import React, { useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Billboard, Line, Html } from '@react-three/drei';

interface TCAMarkerProps {
  position: THREE.Vector3;
  color: string;
  tcaMs: number | null; // epoch ms of time of closest approach, or null if unknown
}

const RING_COUNT = 3;
const LOOP_MS = 1500;
const RING_MAX_RADIUS = 0.05;
const CROSS_SIZE = 0.014;

function formatCountdown(deltaMs: number): string {
  const past = deltaMs <= 0;
  const abs = Math.abs(deltaMs);
  const totalSec = Math.floor(abs / 1000);
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  const t = `${mm}:${ss.toString().padStart(2, '0')}`;
  return past ? `TCA T+${t}` : `TCA T-${t}`;
}

export const TCAMarker: React.FC<TCAMarkerProps> = ({ position, color, tcaMs }) => {
  const ringRefs = useRef<(THREE.Mesh | null)[]>([]);
  const [countdown, setCountdown] = useState('');
  const lastLabelUpdate = useRef(0);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime * 1000;
    for (let i = 0; i < RING_COUNT; i++) {
      const mesh = ringRefs.current[i];
      if (!mesh) continue;
      const stagger = (i * LOOP_MS) / RING_COUNT;
      const phase = ((t + stagger) % LOOP_MS) / LOOP_MS; // 0..1
      const scale = 0.15 + phase * (RING_MAX_RADIUS / 0.02);
      mesh.scale.setScalar(scale);
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.65 * (1 - phase);
    }

    // Update the countdown label roughly once a second, not every frame.
    if (tcaMs !== null && t - lastLabelUpdate.current > 250) {
      lastLabelUpdate.current = t;
      setCountdown(formatCountdown(tcaMs - Date.now()));
    }
  });

  const crossPts: [THREE.Vector3[], THREE.Vector3[]] = [
    [new THREE.Vector3(-CROSS_SIZE, 0, 0), new THREE.Vector3(CROSS_SIZE, 0, 0)],
    [new THREE.Vector3(0, -CROSS_SIZE, 0), new THREE.Vector3(0, CROSS_SIZE, 0)],
  ];

  return (
    <group position={position}>
      <Billboard>
        {Array.from({ length: RING_COUNT }).map((_, i) => (
          <mesh
            key={i}
            ref={(el) => {
              ringRefs.current[i] = el;
            }}
          >
            <ringGeometry args={[0.016, 0.02, 32]} />
            <meshBasicMaterial
              color={color}
              transparent
              opacity={0.5}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
              side={THREE.DoubleSide}
            />
          </mesh>
        ))}

        <Line points={crossPts[0]} color={color} lineWidth={2} depthWrite={false} depthTest={false} />
        <Line points={crossPts[1]} color={color} lineWidth={2} depthWrite={false} depthTest={false} />
      </Billboard>

      {tcaMs !== null && (
        <Html center distanceFactor={4} zIndexRange={[20, 0]}>
          <div
            style={{
              background: 'rgba(10,15,30,0.85)',
              border: `1px solid ${color}`,
              color: '#e8eef7',
              padding: '2px 7px',
              borderRadius: '3px',
              fontSize: '11px',
              fontFamily: 'var(--font-mono)',
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              transform: 'translateY(18px)',
            }}
          >
            {countdown}
          </div>
        </Html>
      )}
    </group>
  );
};
