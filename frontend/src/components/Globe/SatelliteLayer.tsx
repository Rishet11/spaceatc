import React, { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import { useSpaceStore } from '../../store/useSpaceStore';
import { advancePosition } from './orbits';

const MAX_INSTANCES = 500;

// A backend 'satellite_update' tick only lands every so often, so rendering
// the raw store position each frame snapped the dot from tick to tick --
// motionless between ticks at 1x, and an increasingly visible jump at higher
// sim speeds (each tick's position advances further). Track the last two
// ticks per satellite (in real wall-clock time) and rotate the displayed
// position continuously along the great-circle between them instead.
interface OrbitSample {
  prevPos: THREE.Vector3;
  curPos: THREE.Vector3;
  prevTime: number;
  curTime: number;
}
// Cap extrapolation past the last tick at this many tick-intervals, so a
// stalled/disconnected feed freezes the dot instead of spinning it off orbit.
const MAX_EXTRAPOLATE_TICKS = 2.5;

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
  // The track the satellite flew BEFORE the burn. Kept so the judge can see
  // what changed; previously the maneuver deleted exactly this history at the
  // moment it became interesting.
  const frozenTrailsRef = useRef<Map<string, THREE.Vector3[]>>(new Map());
  const [trailUpdate, setTrailUpdate] = React.useState(0);

  // Clear trail event listener
  React.useEffect(() => {
    const handler = (e: any) => {
      const name = e.detail.name;
      const existing = trailsRef.current.get(name);
      if (existing && existing.length > 1) {
        frozenTrailsRef.current.set(name, existing.slice());
      }
      trailsRef.current.delete(name);
      setTrailUpdate(t => t + 1);
    };
    window.addEventListener('clear-trail', handler);
    return () => window.removeEventListener('clear-trail', handler);
  }, []);

  // A fresh conjunction clears the previous encounter's frozen tracks.
  React.useEffect(() => {
    if (activeConjunctions.length === 0) return;
    frozenTrailsRef.current.clear();
  }, [activeConjunctions]);

  // Update trails when satellites change
  React.useEffect(() => {
    // Only the pair in an active conjunction, the resolved pair, or DEMO
    // satellites ever render a trail (see isImportant below) — accumulating
    // 400-point buffers for the other ~195 satellites was pure waste.
    const satsArray = Object.values(satellites).filter(
      (s) =>
        s.lat !== undefined &&
        s.lon !== undefined &&
        s.alt_km !== undefined &&
        !destroyedSatellites.includes(s.name) &&
        (highlightedSats.has(s.name) ||
          s.name?.includes('DEMO') ||
          (!!resolvedEvent && (s.name === resolvedEvent.satA || s.name === resolvedEvent.satB)))
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
        // 40 points at one sample per broadcast spanned only ~5 deg of arc,
        // which reads as a stub rather than an orbit.
        if (trail.length > 400) trail.shift();
      }
    });
    setTrailUpdate(t => t + 1);
  }, [satellites, destroyedSatellites, highlightedSats, resolvedEvent]);

  const orbitSamplesRef = useRef<Map<string, OrbitSample>>(new Map());

  // Record a new backend sample per satellite whenever the store updates
  // (i.e. once per broadcast tick), independent of render frame rate.
  React.useEffect(() => {
    const now = Date.now();
    Object.values(satellites).forEach((sat) => {
      if (sat.lat === undefined || sat.lon === undefined || sat.alt_km === undefined) return;
      const pos = geodeticToThreeJS(sat.lat, sat.lon, sat.alt_km);
      const existing = orbitSamplesRef.current.get(sat.name!);
      if (!existing) {
        orbitSamplesRef.current.set(sat.name!, { prevPos: pos, curPos: pos, prevTime: now, curTime: now });
      } else if (existing.curPos.distanceTo(pos) > 1e-6) {
        orbitSamplesRef.current.set(sat.name!, {
          prevPos: existing.curPos,
          curPos: pos,
          prevTime: existing.curTime,
          curTime: now,
        });
      }
    });
  }, [satellites]);

  const displayPosition = (name: string, fallback: THREE.Vector3): THREE.Vector3 => {
    const sample = orbitSamplesRef.current.get(name);
    if (!sample) return fallback;
    const tickSpan = sample.curTime - sample.prevTime;
    if (tickSpan <= 0) return sample.curPos;
    const ticksSinceUpdate = (Date.now() - sample.curTime) / tickSpan;
    const progress = 1 + Math.min(ticksSinceUpdate, MAX_EXTRAPOLATE_TICKS);
    return advancePosition(sample.prevPos, sample.curPos, progress);
  };

  useFrame(() => {
    if (!meshRef.current) return;

    const satsArray = Object.values(satellites).filter(
      (s) =>
        s.lat !== undefined &&
        s.lon !== undefined &&
        s.alt_km !== undefined &&
        !destroyedSatellites.includes(s.name)
    );

    const mesh = meshRef.current;
    let visibleCount = 0;

    satsArray.forEach((sat, i) => {
      if (i >= MAX_INSTANCES) return;

      const rawPos = geodeticToThreeJS(sat.lat!, sat.lon!, sat.alt_km!);
      const pos = displayPosition(sat.name!, rawPos);
      tempObject.position.copy(pos);

      const isHighlighted = highlightedSats.has(sat.name!);
      
      // The conjunction pair has to be findable among ~200 other dots.
      const isResolvedSat =
        !!resolvedEvent && (sat.name === resolvedEvent.satA || sat.name === resolvedEvent.satB);
      const scale = isHighlighted || isResolvedSat
        ? 4.5
        : sat.name?.includes('DEMO')
          ? 2.0
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
        // Desaturated so the highlighted pair reads first against the crowd.
        tempColor.set('#3d6c88'); // muted blue: Starlink background
      } else {
        tempColor.set('#8a6640'); // muted orange: other operators
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
        {/* Was 0.004 — at 202 satellites against a full globe that read as
            essentially empty. Additive blending gives the dots a bit of glow
            without competing with the (much brighter, dashed) conjunction
            paths, which still win on width + bloom threshold. */}
        <sphereGeometry args={[0.009, 8, 8]} />
        <meshBasicMaterial transparent blending={THREE.AdditiveBlending} depthWrite={false} />
      </instancedMesh>
      
      {/* Pre-maneuver track: the path the satellite WOULD have flown, kept on
          screen next to the new one so the change is legible at a glance. */}
      {Array.from(frozenTrailsRef.current.entries()).map(([name, trail]) => {
        if (trail.length < 2) return null;
        if (destroyedSatellites.includes(name)) return null;
        return (
          <Line
            key={`frozen-${name}`}
            points={trail}
            color="#ef4444"
            lineWidth={2}
            transparent
            opacity={0.5}
            depthWrite={false}
            dashed
            dashSize={0.012}
            gapSize={0.012}
          />
        );
      })}

      {/* Render Trails */}
      {Array.from(trailsRef.current.entries()).map(([name, trail]) => {
        if (trail.length < 2) return null;
        if (destroyedSatellites.includes(name)) return null;

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
        // Fade brightness, not toward black: under additive blending a black
        // vertex contributes nothing, so the older half of every trail was
        // rendering as literally invisible.
        const dim = colorObj.clone().multiplyScalar(0.25);
        const vertexColors = trail.map((_, i) => {
          const ratio = trail.length > 1 ? i / (trail.length - 1) : 1;
          return dim.clone().lerp(colorObj, ratio);
        });

        return (
          <Line
            key={name}
            points={trail}
            vertexColors={vertexColors.map(c => [c.r, c.g, c.b])}
            lineWidth={3}
            blending={THREE.AdditiveBlending}
            transparent
            opacity={0.95}
            depthWrite={false}
            dashed={false}
          />
        );
      })}
    </>
  );
};
