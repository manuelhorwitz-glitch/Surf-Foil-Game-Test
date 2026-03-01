import { useFrame, extend } from '@react-three/fiber';
import { shaderMaterial } from '@react-three/drei';
import { useRef, useMemo } from 'react';
import * as THREE from 'three';

// --- 3 Gerstner Waves + Weighted Shoaling + Breaking + Full Shading ---
const WAVE_COUNT = 3;

const GerstnerWaveMaterial = shaderMaterial(
  {
    uTime: 0,
    uWaveDirX:      [0.0,  0.15, -0.2],
    uWaveDirZ:      [1.0,  0.99,  0.98],
    uWaveSteepness: [0.12, 0.08,  0.06],
    uWaveLength:    [25.0, 15.0,  8.0],
    uWaveAmplitude: [1.2,  0.4,   0.15],
    uWaveSpeed:     [4.0,  3.5,   5.0],
    uDepthDeep: 10.0,
    uDepthShallow: 1.5,
    uShoreAngle: 0.42,
    uShoreZCenter: 30.0,
    uDepthGradient: 0.12,
    uSunDirection: new THREE.Vector3(0.5, 0.8, 0.3).normalize(),
    uDeepColor: new THREE.Color(0.0, 0.12, 0.30),
    uShallowColor: new THREE.Color(0.0, 0.45, 0.55),
    uSSSColor: new THREE.Color(0.05, 0.75, 0.55),
    uFoamColor: new THREE.Color(0.95, 0.98, 1.0),
    uSkyColor: new THREE.Color(0.5, 0.7, 1.0),
  },
  // Vertex Shader
  /*glsl*/`
    uniform float uTime;
    uniform float uWaveDirX[${WAVE_COUNT}];
    uniform float uWaveDirZ[${WAVE_COUNT}];
    uniform float uWaveSteepness[${WAVE_COUNT}];
    uniform float uWaveLength[${WAVE_COUNT}];
    uniform float uWaveAmplitude[${WAVE_COUNT}];
    uniform float uWaveSpeed[${WAVE_COUNT}];
    uniform float uDepthDeep;
    uniform float uDepthShallow;
    uniform float uShoreAngle;
    uniform float uShoreZCenter;
    uniform float uDepthGradient;

    varying vec3 vWorldPosition;
    varying vec3 vNormal;
    varying float vHeight;
    varying float vFoam;
    varying float vDepth;

    float getDepth(float x, float z) {
      float effectiveZ = z - x * uShoreAngle;
      float rawDepth = uDepthDeep - (effectiveZ - uShoreZCenter) * uDepthGradient;
      return clamp(rawDepth, uDepthShallow, uDepthDeep);
    }

    vec3 gerstnerWaves(vec3 pos, float time) {
      vec3 result = pos;

      // Pre-compute wave 0 phase for breaking (includes time — crest moves naturally)
      float k0 = 6.28318 / uWaveLength[0];
      float f0 = k0 * (uWaveDirX[0] * pos.x + uWaveDirZ[0] * pos.z - uWaveSpeed[0] * time);

      for (int i = 0; i < ${WAVE_COUNT}; i++) {
        float amplitude = uWaveAmplitude[i];
        float steepness = uWaveSteepness[i];

        // Shoaling: all waves, weighted (wave 0 = full, others = 30%)
        float depth = getDepth(pos.x, pos.z);
        float depthRatio = max(depth / uDepthDeep, 0.05);
        float shoalFactor = 1.0 / sqrt(depthRatio);
        float shoalWeight = (i == 0) ? 1.0 : 0.3;
        float effectiveShoal = 1.0 + (shoalFactor - 1.0) * shoalWeight;
        amplitude *= effectiveShoal;
        steepness *= effectiveShoal;
        steepness = min(steepness, 0.4);

        // Standard Gerstner phase — ALL waves, ALL with time
        float k = 6.28318 / uWaveLength[i];
        float f = k * (uWaveDirX[i] * pos.x + uWaveDirZ[i] * pos.z - uWaveSpeed[i] * time);
        float a = amplitude;
        float q = clamp(steepness / (k * a * float(${WAVE_COUNT})), 0.0, 0.5);

        result.x += q * a * uWaveDirX[i] * cos(f);
        result.y += a * sin(f);
        result.z += q * a * uWaveDirZ[i] * cos(f);
      }

      // --- Breaking / Tube formation ---
      float depth = getDepth(pos.x, pos.z);
      float breakStrength = smoothstep(5.0, 2.0, depth);

      if (breakStrength > 0.001) {
        float sinF0 = sin(f0);
        float crestFactor = smoothstep(0.0, 0.8, sinF0);
        float breakAmount = crestFactor * crestFactor * breakStrength;

        float foldAngle = breakAmount * 3.0;

        float aboveWater = max(result.y, 0.0);
        float belowWater = min(result.y, 0.0);

        result.y = belowWater + aboveWater * cos(foldAngle);
        result.z += aboveWater * sin(foldAngle);       // lip curls toward shore (+Z)

        float throwForward = breakAmount * breakAmount * aboveWater * 1.8;
        result.z += throwForward;                       // throw-ahead in propagation direction
      }

      return result;
    }

    void main() {
      vec3 pos = position;
      vec3 displaced = gerstnerWaves(pos, uTime);

      float eps = 0.2;
      vec3 pX = gerstnerWaves(pos + vec3(eps, 0.0, 0.0), uTime);
      vec3 nX = gerstnerWaves(pos - vec3(eps, 0.0, 0.0), uTime);
      vec3 pZ = gerstnerWaves(pos + vec3(0.0, 0.0, eps), uTime);
      vec3 nZ = gerstnerWaves(pos - vec3(0.0, 0.0, eps), uTime);

      vec3 tangentX = (pX - nX) / (2.0 * eps);
      vec3 tangentZ = (pZ - nZ) / (2.0 * eps);
      vec3 normal = normalize(cross(tangentZ, tangentX));

      vWorldPosition = (modelMatrix * vec4(displaced, 1.0)).xyz;
      vNormal = normalize(normalMatrix * normal);
      vHeight = displaced.y;
      vDepth = getDepth(pos.x, pos.z);

      // Foam: height + slope steepness + break zone
      float slopeMag = abs(tangentX.y) + abs(tangentZ.y);
      float heightFactor = smoothstep(0.2, 1.5, displaced.y);
      float breakZone = smoothstep(5.0, uDepthShallow + 1.0, vDepth);
      vFoam = clamp(heightFactor * slopeMag * 2.0 + breakZone * heightFactor * 1.5, 0.0, 1.0);

      gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
    }
  `,
  // Fragment Shader — full SSS, foam, FBM noise
  /*glsl*/`
    uniform vec3 uSunDirection;
    uniform vec3 uDeepColor;
    uniform vec3 uShallowColor;
    uniform vec3 uSSSColor;
    uniform vec3 uFoamColor;
    uniform vec3 uSkyColor;
    uniform float uTime;

    varying vec3 vWorldPosition;
    varying vec3 vNormal;
    varying float vHeight;
    varying float vFoam;
    varying float vDepth;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }

    float fbm(vec2 p) {
      float val = 0.0;
      float amp = 0.5;
      for (int i = 0; i < 4; i++) {
        val += amp * noise(p);
        p *= 2.1;
        amp *= 0.5;
      }
      return val;
    }

    void main() {
      vec3 normal = normalize(vNormal);
      vec3 viewDir = normalize(cameraPosition - vWorldPosition);

      // Scrolling normal perturbation (fake normal map from 3 FBM layers)
      vec2 uv1 = vWorldPosition.xz * 0.5 + uTime * vec2(0.02, 0.03);
      vec2 uv2 = vWorldPosition.xz * 0.3 + uTime * vec2(-0.01, 0.02);
      vec2 uv3 = vWorldPosition.xz * 1.2 + uTime * vec2(0.04, -0.01);
      float n1 = fbm(uv1 * 3.0);
      float n2 = fbm(uv2 * 5.0);
      float n3 = fbm(uv3 * 8.0);
      vec3 perturbedNormal = normalize(normal + vec3(
        (n1 - 0.5) * 0.12 + (n3 - 0.5) * 0.04,
        0.0,
        (n2 - 0.5) * 0.12 + (n3 - 0.5) * 0.04
      ));

      // Base color: deep vs shallow
      float depthMix = clamp(vDepth / 10.0, 0.0, 1.0);
      vec3 baseColor = mix(uShallowColor, uDeepColor, depthMix);

      // Subsurface Scattering
      float sssThickness = clamp(1.0 - dot(perturbedNormal, uSunDirection), 0.0, 1.0);
      float sssHeight = smoothstep(0.0, 2.0, vHeight);
      float sssFactor = sssThickness * sssHeight * 0.7;
      float viewSSS = pow(max(dot(viewDir, -uSunDirection), 0.0), 3.0) * 0.3;
      vec3 sssContrib = uSSSColor * (sssFactor + viewSSS * sssHeight);

      // Diffuse
      float NdotL = max(dot(perturbedNormal, uSunDirection), 0.0);
      float diffuse = NdotL * 0.6 + 0.4;

      // Specular
      vec3 halfDir = normalize(uSunDirection + viewDir);
      float spec = pow(max(dot(perturbedNormal, halfDir), 0.0), 128.0);
      vec3 specColor = vec3(1.0) * spec * 0.5;

      // Fresnel
      float fresnel = pow(1.0 - max(dot(perturbedNormal, viewDir), 0.0), 4.0);
      vec3 fresnelColor = uSkyColor * fresnel * 0.4;

      // Foam
      float foamNoise = fbm(vWorldPosition.xz * 2.0 + uTime * 0.5);
      float foamMask = smoothstep(0.3, 0.7, vFoam + foamNoise * 0.3);
      vec3 foam = uFoamColor * foamMask;

      // Combine
      vec3 color = baseColor * diffuse + sssContrib + specColor + fresnelColor;
      color = mix(color, foam, foamMask * 0.8);
      color = color / (color + vec3(1.0)); // tone mapping

      gl_FragColor = vec4(color, 0.92);
    }
  `
);

extend({ GerstnerWaveMaterial });

declare module '@react-three/fiber' {
  interface ThreeElements {
    gerstnerWaveMaterial: any;
  }
}

interface WaveSurfaceProps {
  size?: number;
  segments?: number;
}

export default function WaveSurface({ size = 120, segments = 256 }: WaveSurfaceProps) {
  const materialRef = useRef<any>(null);

  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, [size, segments]);

  useFrame((state) => {
    if (materialRef.current) {
      materialRef.current.uTime = state.clock.elapsedTime;
    }
  });

  return (
    <mesh geometry={geometry}>
      <gerstnerWaveMaterial
        ref={materialRef}
        transparent
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
