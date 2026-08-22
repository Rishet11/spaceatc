import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { extend, useFrame } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import { geodeticToThreeJS } from './SatelliteLayer';

const EARTH_RADIUS = 1.0;

// ---------------------------------------------------------------------------
// Subsolar point (real current UTC date -> sun direction), expressed in the
// SAME coordinate convention as geodeticToThreeJS in SatelliteLayer.tsx:
//   x = R cos(lat) cos(lon), y = R sin(lat), z = R cos(lat) sin(lon)
// Feeding the subsolar (lat, lon) through that exact function guarantees the
// terminator lines up with where satellites actually render, since neither
// this globe nor the satellite layer apply any additional Earth-rotation
// transform (both live in the same static Earth-fixed frame).
// ---------------------------------------------------------------------------
export function subsolarDirection(date: Date): THREE.Vector3 {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((date.getTime() - start) / 86400000);

  // Solar declination, standard approximation.
  const declDeg = 23.44 * Math.sin(THREE.MathUtils.degToRad((360 / 365) * (dayOfYear - 81)));

  // Subsolar longitude: ignores the (~<=16min) equation-of-time correction,
  // negligible for a visual terminator at this scale.
  const utcHours =
    date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const lonDeg = -(utcHours - 12) * 15;

  return geodeticToThreeJS(declDeg, lonDeg, 0).normalize();
}

// ---------------------------------------------------------------------------
// Day/night blended Earth material (Phong/Standard can't do a per-fragment
// sun-angle blend between two full texture sets).
// ---------------------------------------------------------------------------
const vertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;

  void main() {
    vUv = uv;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D dayMap;
  uniform sampler2D nightMap;
  uniform sampler2D normalMap;
  uniform sampler2D specularMap;
  uniform vec3 sunDirection;
  uniform vec3 cameraPos;

  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;

  void main() {
    vec3 nmSample = texture2D(normalMap, vUv).rgb * 2.0 - 1.0;
    vec3 normal = normalize(vNormal + nmSample * 0.15);

    float dayMix = smoothstep(-0.15, 0.15, dot(normal, sunDirection));

    vec3 dayColor = texture2D(dayMap, vUv).rgb;
    vec3 nightColor = texture2D(nightMap, vUv).rgb;
    vec3 color = mix(nightColor * 1.3, dayColor, dayMix);

    // Blinn-Phong ocean sheen, lit side only, masked by the specular map.
    vec3 viewDir = normalize(cameraPos - vWorldPosition);
    vec3 halfDir = normalize(sunDirection + viewDir);
    float specAngle = max(dot(normal, halfDir), 0.0);
    float specStrength = pow(specAngle, 32.0);
    float specMask = texture2D(specularMap, vUv).r;
    vec3 specColor = vec3(1.0, 1.0, 0.95) * specStrength * specMask * dayMix;

    gl_FragColor = vec4(color + specColor, 1.0);
  }
`;

interface EarthUniforms {
  dayMap: THREE.Texture | null;
  nightMap: THREE.Texture | null;
  normalMap: THREE.Texture | null;
  specularMap: THREE.Texture | null;
  sunDirection: THREE.Vector3;
  cameraPos: THREE.Vector3;
}

class EarthMaterialImpl extends THREE.ShaderMaterial {
  constructor() {
    const uniforms: { [K in keyof EarthUniforms]: { value: EarthUniforms[K] } } = {
      dayMap: { value: null },
      nightMap: { value: null },
      normalMap: { value: null },
      specularMap: { value: null },
      sunDirection: { value: new THREE.Vector3(1, 0, 0) },
      cameraPos: { value: new THREE.Vector3() },
    };
    super({ uniforms, vertexShader, fragmentShader });
  }
}

extend({ EarthMaterialImpl });

declare module '@react-three/fiber' {
  interface ThreeElements {
    earthMaterialImpl: any;
  }
}

export const EarthGlobe: React.FC = () => {
  const [dayMap, nightMap, normalMap, specularMap] = useTexture([
    '/textures/earth/day.jpg',
    '/textures/earth/night.jpg',
    '/textures/earth/normal.jpg',
    '/textures/earth/specular.jpg',
  ]);

  const materialRef = useRef<EarthMaterialImpl>(null);
  const lastUpdate = useRef(0);

  // EarthMaterialImpl is a hand-rolled THREE.ShaderMaterial subclass, not one
  // built via drei's shaderMaterial() factory — so it has no generated
  // property accessors mapping JSX props straight to uniforms.*.value. Bind
  // the textures (and the initial sun direction) imperatively once they're
  // ready; passing them as JSX props alone silently left uniforms.dayMap etc
  // at their null default, which sampled as solid black.
  useEffect(() => {
    const mat = materialRef.current;
    if (!mat) return;
    mat.uniforms.dayMap.value = dayMap;
    mat.uniforms.nightMap.value = nightMap;
    mat.uniforms.normalMap.value = normalMap;
    mat.uniforms.specularMap.value = specularMap;
    mat.uniforms.sunDirection.value.copy(subsolarDirection(new Date()));
  }, [dayMap, nightMap, normalMap, specularMap]);

  useFrame((state) => {
    const mat = materialRef.current;
    if (!mat) return;
    mat.uniforms.cameraPos.value.copy(state.camera.position);

    // Recompute the sun direction about once a second, not every frame.
    const now = state.clock.elapsedTime;
    if (now - lastUpdate.current > 1) {
      lastUpdate.current = now;
      mat.uniforms.sunDirection.value.copy(subsolarDirection(new Date()));
    }
  });

  return (
    <mesh>
      <sphereGeometry args={[EARTH_RADIUS, 64, 64]} />
      {/* @ts-ignore custom material registered via extend() */}
      <earthMaterialImpl ref={materialRef} />
    </mesh>
  );
};

// ---------------------------------------------------------------------------
// Atmosphere — fresnel rim glow, back-side sphere, additive.
// ---------------------------------------------------------------------------
const atmosphereVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewDir = normalize(-mvPosition.xyz);
    gl_Position = projectionMatrix * mvPosition;
  }
`;
const atmosphereFragment = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  uniform vec3 glowColor;
  void main() {
    float intensity = pow(0.65 - dot(vNormal, vViewDir), 3.0);
    gl_FragColor = vec4(glowColor, 1.0) * clamp(intensity, 0.0, 1.0);
  }
`;

export const Atmosphere: React.FC = () => {
  const uniforms = useMemo(() => ({ glowColor: { value: new THREE.Color('#4fc3f7') } }), []);
  return (
    <mesh scale={1.03}>
      <sphereGeometry args={[EARTH_RADIUS, 64, 64]} />
      <shaderMaterial
        vertexShader={atmosphereVertex}
        fragmentShader={atmosphereFragment}
        uniforms={uniforms}
        transparent
        side={THREE.BackSide}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </mesh>
  );
};

// ---------------------------------------------------------------------------
// Clouds — independent slow rotation, ~15% faster than the base globe.
// The base globe itself is intentionally static (satellite lat/lon positions
// are rendered in the same non-rotating Earth-fixed frame with no counter-
// rotation applied), so cloud motion is expressed as its own small constant
// rate rather than as a literal multiple of a zero Earth rotation.
// ---------------------------------------------------------------------------
const CLOUD_ROTATION_SPEED = 0.0023; // rad/s (~15% faster than a nominal 0.002 rad/s reference)

export const Clouds: React.FC = () => {
  const cloudsMap = useTexture('/textures/earth/clouds.jpg');
  const ref = useRef<THREE.Mesh>(null);

  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += CLOUD_ROTATION_SPEED * delta;
  });

  return (
    <mesh ref={ref} scale={1.01}>
      <sphereGeometry args={[EARTH_RADIUS, 64, 64]} />
      <meshStandardMaterial
        map={cloudsMap}
        alphaMap={cloudsMap}
        transparent
        opacity={0.55}
        depthWrite={false}
      />
    </mesh>
  );
};
