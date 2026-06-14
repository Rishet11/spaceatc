import React, { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import { useSpaceStore } from '../../store/useSpaceStore';

const MAX_INSTANCES = 500;

/**
 * Convert geodetic coordinates (lat, lon, alt_km) to Three.js sphere position.
 * Earth radius = 1.0 in scene units, altitude scaled proportionally.
 */
function geodeticToThreeJS(
  lat: number,
  lon: number,
  alt_km: number
): THREE.Vector3 {
  const R = 1.0 + alt_km / 6371.0;
  const latRad = lat * (Math.PI / 180);
  const lonRad = lon * (Math.PI / 180);

  return new THREE.Vector3(
    R * Math.cos(latRad) * Math.cos(lonRad),
    R * Math.sin(latRad),
    R * Math.cos(latRad) * Math.sin(lonRad)
  );
}

export { geodeticToThreeJS };

export const SatelliteLayer: React.FC = () => {
  const satellites = useSpaceStore((state) => state.satellites);
  const destroyedSatellites = useSpaceStore((state) => state.destroyedSatellites);
  const resolvedEvent = useSpaceStore((state) => state.resolvedEvent);
  const activeConjunctions = useSpaceStore((state) => state.activeConjunctions);

  // Memoize highlighted satellite names for quick lookup
  const highlightedSats = useMemo(() => {
    const s = new Set<string>();
    activeConjunctions.forEach(c => {
      if (c.status === 'detected' || c.status === 'negotiating' || c.status === 'pending_hitl') {
        s.add(c.sat_primary);
        s.add(c.sat_secondary);
      }
    });
    return s;
  }, [activeConjunctions]);

  const meshRef = useRef<THREE.InstancedMesh>(null);
  const tempObject = useMemo(() => new THREE.Object3D(), []);
  const tempColor = useMemo(() => new THREE.Color(), []);

  const trailsRef = useRef<Map<string, THREE.Vector3[]>>(new Map());
  const [trailUpdate, setTrailUpdate] = React.useState(0);

  // Clear trail event listener
  React.useEffect(() => {
    const handler = (e: any) => {
      trailsRef.current.delete(e.detail.name);
      setTrailUpdate(t => t + 1);
    };
    window.addEventListener('clear-trail', handler);
    return () => window.removeEventListener('clear-trail', handler);
  }, []);

  // Update trails when satellites change
  React.useEffect(() => {
    const satsArray = Object.values(satellites).filter(
      (s) =>
        s.lat !== undefined &&
        s.lon !== undefined &&
        s.alt_km !== undefined &&
        !destroyedSatellites.includes(s.name)
    );

    satsArray.forEach((sat) => {
      const pos = geodeticToThreeJS(sat.lat!, sat.lon!, sat.alt_km!);
      let trail = trailsRef.current.get(sat.name);
      if (!trail) {
        trail = [];
        trailsRef.current.set(sat.name, trail);
      }
      if (trail.length === 0 || trail[trail.length - 1].distanceTo(pos) > 0.001) {
        trail.push(pos);
        if (trail.length > 40) trail.shift();
      }
    });
    setTrailUpdate(t => t + 1);
  }, [satellites, destroyedSatellites]);

  useFrame(() => {
    if (!meshRef.current) return;

    const satsArray = Object.values(satellites).filter(
      (s) =>
        s.lat !== undefined &&
        s.lon !== undefined &&
        s.alt_km !== undefined &&
        !destroyedSatellites.includes(s.name)
    );

    // Debug log (remove after confirming satellites render)
    if (satsArray.length > 0 && Math.random() < 0.002) {
      console.log('Satellites in store:', satsArray.length, satsArray[0]);
    }

    const mesh = meshRef.current;
    let visibleCount = 0;

    satsArray.forEach((sat, i) => {
      if (i >= MAX_INSTANCES) return;

      const pos = geodeticToThreeJS(sat.lat!, sat.lon!, sat.alt_km!);
      tempObject.position.copy(pos);

      const isHighlighted = highlightedSats.has(sat.name!);
      
      // Scale: highlighted = 2×, DEMO = 1.5×, normal = 1×
      const scale = isHighlighted
        ? 2.0
        : sat.name?.includes('DEMO')
          ? 1.5
          : 1.0;
      tempObject.scale.setScalar(scale);
      tempObject.updateMatrix();
      mesh.setMatrixAt(i, tempObject.matrix);

      // Color by operator / highlight state
      if (resolvedEvent && (sat.name === resolvedEvent.satA || sat.name === resolvedEvent.satB)) {
        tempColor.set('#22c55e'); // green: resolved
      } else if (isHighlighted) {
        tempColor.set('#ef4444'); // red: conjunction
      } else if (sat.name?.includes('DEMO')) {
        tempColor.set('#ffffff'); // white: demo
      } else if (sat.operator?.includes('SpaceX') || sat.operator?.includes('Starlink')) {
        tempColor.set('#4fc3f7'); // blue: Starlink
      } else {
        tempColor.set('#ff9800'); // orange: others
      }
      mesh.setColorAt(i, tempColor);

      visibleCount++;
    });

    // Hide remaining instances by scaling to zero
    for (let i = visibleCount; i < MAX_INSTANCES; i++) {
      tempObject.position.set(0, 0, 0);
      tempObject.scale.setScalar(0);
      tempObject.updateMatrix();
      mesh.setMatrixAt(i, tempObject.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }

    // Update visible count for frustum culling
    mesh.count = visibleCount;
  });

  return (
    <>
      <instancedMesh
        ref={meshRef}
        args={[undefined, undefined, MAX_INSTANCES]}
        frustumCulled={false}
      >
        <sphereGeometry args={[0.004, 6, 6]} />
        <meshBasicMaterial />
      </instancedMesh>
      
      {/* Render Trails */}
      {Array.from(trailsRef.current.entries()).map(([name, trail]) => {
        if (trail.length < 2) return null;
        
        const satKey = Object.keys(satellites).find(k => satellites[k].name === name);
        const sat = satKey ? satellites[satKey] : null;
        
        const isResolved = resolvedEvent && (name === resolvedEvent.satA || name === resolvedEvent.satB);
        const isHighlighted = sat ? highlightedSats.has(sat.name!) : false;
        const isImportant = sat && (isHighlighted || sat.name?.includes('DEMO') || isResolved);
        
        if (!isImportant) return null;

        let colorStr = '#ff9800';
        if (sat) {
          if (isResolved) colorStr = '#22c55e';
          else if (isHighlighted) colorStr = '#ef4444';
          else if (sat.name?.includes('DEMO')) colorStr = '#ffffff';
          else if (sat.operator?.includes('SpaceX') || sat.operator?.includes('Starlink')) colorStr = '#4fc3f7';
        }
        
        const colorObj = new THREE.Color(colorStr);
        const black = new THREE.Color('#000000');
        const vertexColors = trail.map((_, i) => {
          const ratio = i / (trail.length - 1);
          return black.clone().lerp(colorObj, ratio);
        });

        return (
          <Line
            key={name}
            points={trail}
            vertexColors={vertexColors.map(c => [c.r, c.g, c.b])}
            lineWidth={1.5}
            blending={THREE.AdditiveBlending}
            transparent
            opacity={0.8}
            depthWrite={false}
            dashed={false}
          />
        );
      })}
    </>
  );
};
