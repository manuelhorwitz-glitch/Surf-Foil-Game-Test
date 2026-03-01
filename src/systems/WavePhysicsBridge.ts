import * as THREE from 'three';

/**
 * WavePhysicsBridge: CPU-side port of the GPU Gerstner wave shader.
 *
 * CRITICAL: These formulas MUST match the vertex shader in IsolatedWaveScene.tsx exactly.
 * Any divergence means the surfer physics won't match the visual wave surface.
 *
 * Current state: 3 Gerstner waves, shoaling on wave 0 only, breaking/tube fold.
 */

// --- Wave definitions (must mirror shader uniforms exactly) ---
interface WaveDef {
  dirX: number;
  dirZ: number;
  steepness: number;
  wavelength: number;
  amplitude: number;
  speed: number;
}

const WAVES: WaveDef[] = [
  // Wave 0: main swell (shoaling applied)
  { dirX: 0.0, dirZ: 1.0, steepness: 0.15, wavelength: 20.0, amplitude: 1.0, speed: 2.0 },
  // Wave 1: wind chop (no shoaling)
  { dirX: 0.3, dirZ: 0.95, steepness: 0.10, wavelength: 10.0, amplitude: 0.3, speed: 3.0 },
  // Wave 2: cross chop (no shoaling)
  { dirX: -0.2, dirZ: 0.98, steepness: 0.08, wavelength: 6.0, amplitude: 0.15, speed: 3.5 },
];

// Depth gradient params (must mirror shader uniforms)
const DEPTH_DEEP = 12.0;
const DEPTH_SHALLOW = 3.0;
const DEPTH_Z_DEEP = -40.0;
const DEPTH_Z_SHALLOW = 40.0;
const REEF_SLOPE = 0.3;  // Angled reef — creates peeling break (must mirror shader uReefSlope)

const WAVE_COUNT = WAVES.length;

/** Angled depth gradient — mirrors shader getDepth(x, z) */
function getDepth(x: number, z: number): number {
  const effectiveZ = z - x * REEF_SLOPE;
  const t = Math.max(0, Math.min((effectiveZ - DEPTH_Z_DEEP) / (DEPTH_Z_SHALLOW - DEPTH_Z_DEEP), 1.0));
  return DEPTH_DEEP + (DEPTH_SHALLOW - DEPTH_DEEP) * t;
}

/**
 * Compute the displaced position of a vertex at (x, 0, z) under 3 Gerstner waves.
 * Mirrors the vertex shader's gerstnerWaves() function exactly.
 */
/** GLSL-compatible smoothstep */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min((x - edge0) / (edge1 - edge0), 1.0));
  return t * t * (3 - 2 * t);
}

function gerstnerDisplace(x: number, z: number, time: number): THREE.Vector3 {
  let rx = x;
  let ry = 0;
  let rz = z;

  // Pre-calculate wave 0 phase for breaking logic
  const k0 = (2 * Math.PI) / WAVES[0].wavelength;
  const f0 = k0 * (WAVES[0].dirX * x + WAVES[0].dirZ * z - WAVES[0].speed * time);

  for (let i = 0; i < WAVE_COUNT; i++) {
    const w = WAVES[i];
    let amplitude = w.amplitude;
    let steepness = w.steepness;
    const waveLen = w.wavelength;

    // Shoaling: only wave 0 (main swell) is affected by depth
    if (i === 0) {
      const depth = getDepth(x, z);
      const depthRatio = depth / DEPTH_DEEP;           // 1.0 in deep, ~0.25 in shallow
      const shoalFactor = 1.0 / Math.sqrt(depthRatio); // 1.0 in deep, ~2.0 in shallow
      amplitude *= shoalFactor;
      steepness *= shoalFactor;
      // Safety clamp — matches shader
      steepness = Math.min(steepness, 0.35);
    }

    const k = (2 * Math.PI) / waveLen;
    const f = k * (w.dirX * x + w.dirZ * z - w.speed * time);
    const a = amplitude;
    // Q per-wave, clamped to 0.5 — matches shader
    const q = Math.max(0, Math.min(steepness / (k * a * WAVE_COUNT), 0.5));

    rx += q * a * w.dirX * Math.cos(f);
    ry += a * Math.sin(f);
    rz += q * a * w.dirZ * Math.cos(f);
  }

  // --- Breaking / Tube formation ---
  // Mirrors shader logic exactly
  const depth = getDepth(x, z);
  const breakStrength = smoothstep(6.0, 3.0, depth);

  if (breakStrength > 0.001) {
    const sinF0 = Math.sin(f0);
    const crestFactor = smoothstep(0.0, 0.8, sinF0);
    const breakAmount = crestFactor * crestFactor * breakStrength;

    // Full barrel rotation: ~172° max
    const foldAngle = breakAmount * 3.0;

    const aboveWater = Math.max(ry, 0);
    const belowWater = Math.min(ry, 0);

    // Rotate crest over the steep front face (-Z side after Gerstner bunching)
    ry = belowWater + aboveWater * Math.cos(foldAngle);
    rz -= aboveWater * Math.sin(foldAngle);

    // Forward throw: lip launched over the face into the trough
    const throwForward = breakAmount * breakAmount * aboveWater * 1.8;
    rz -= throwForward;
  }

  return new THREE.Vector3(rx, ry, rz);
}

export interface WaveSurfaceSample {
  height: number;
  normal: THREE.Vector3;
  velocity: THREE.Vector3;
}

const _eps = 0.2; // matches shader eps
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

/**
 * Sample the wave surface at a given world X/Z coordinate.
 * Returns height, surface normal, and surface velocity at that point.
 */
export function getWaterSurfaceAt(x: number, z: number, time: number): WaveSurfaceSample {
  const center = gerstnerDisplace(x, z, time);

  // Normal via finite differences (matches shader approach)
  const posX = gerstnerDisplace(x + _eps, z, time);
  const negX = gerstnerDisplace(x - _eps, z, time);
  const posZ = gerstnerDisplace(x, z + _eps, time);
  const negZ = gerstnerDisplace(x, z - _eps, time);

  _v1.set(
    (posX.x - negX.x) / (2 * _eps),
    (posX.y - negX.y) / (2 * _eps),
    (posX.z - negX.z) / (2 * _eps),
  );
  _v2.set(
    (posZ.x - negZ.x) / (2 * _eps),
    (posZ.y - negZ.y) / (2 * _eps),
    (posZ.z - negZ.z) / (2 * _eps),
  );

  const normal = new THREE.Vector3().crossVectors(_v2, _v1).normalize();

  // Surface velocity via time derivative (finite difference in time)
  const dt = 0.01;
  const future = gerstnerDisplace(x, z, time + dt);
  const velocity = new THREE.Vector3(
    (future.x - center.x) / dt,
    (future.y - center.y) / dt,
    (future.z - center.z) / dt,
  );

  return {
    height: center.y,
    normal,
    velocity,
  };
}

/**
 * Get just the wave height (fast path for simple lookups).
 */
export function getWaveHeightAt(x: number, z: number, time: number): number {
  return gerstnerDisplace(x, z, time).y;
}

/**
 * Get the wave slope at a point (gradient of the height field).
 */
export function getWaveSlopeAt(x: number, z: number, time: number): { slopeX: number; slopeZ: number } {
  const hRight = gerstnerDisplace(x + _eps, z, time).y;
  const hLeft = gerstnerDisplace(x - _eps, z, time).y;
  const hFront = gerstnerDisplace(x, z + _eps, time).y;
  const hBack = gerstnerDisplace(x, z - _eps, time).y;
  return {
    slopeX: (hRight - hLeft) / (2 * _eps),
    slopeZ: (hFront - hBack) / (2 * _eps),
  };
}

/**
 * Export wave config so other systems can read it.
 */
export const WAVE_CONFIG = {
  waves: WAVES,
  depthDeep: DEPTH_DEEP,
  depthShallow: DEPTH_SHALLOW,
  depthZDeep: DEPTH_Z_DEEP,
  depthZShallow: DEPTH_Z_SHALLOW,
  reefSlope: REEF_SLOPE,
} as const;
