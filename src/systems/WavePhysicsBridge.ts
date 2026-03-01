import * as THREE from 'three';

/**
 * WavePhysicsBridge: CPU-side port of the GPU Gerstner wave shader.
 *
 * CRITICAL: These formulas MUST match the vertex shader in WaveSurface.tsx exactly.
 * Any divergence means the surfer physics won't match the visual wave surface.
 *
 * Architecture: 3 Gerstner waves propagate naturally via standard phase formula.
 * A diagonal beach creates depth gradient that triggers shoaling + breaking.
 * The mesh is stationary — waves move through it. One coordinate space (world).
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
  // Wave 0: main swell — fully shoals
  { dirX: 0.0, dirZ: 1.0, steepness: 0.12, wavelength: 25.0, amplitude: 1.2, speed: 4.0 },
  // Wave 1: secondary swell — shoals at 30%
  { dirX: 0.15, dirZ: 0.99, steepness: 0.08, wavelength: 15.0, amplitude: 0.4, speed: 3.5 },
  // Wave 2: cross chop — shoals at 30%
  { dirX: -0.2, dirZ: 0.98, steepness: 0.06, wavelength: 8.0, amplitude: 0.15, speed: 5.0 },
];

// Diagonal beach depth parameters (must mirror shader uniforms)
const SHORE_ANGLE = 0.42;       // tan(~23°) — tilts shoreline diagonally
const DEPTH_DEEP = 10.0;        // meters — deep water depth
const DEPTH_SHALLOW = 1.5;      // meters — shallowest before beach
const SHORE_Z_CENTER = 30.0;    // Z where depth transitions at x=0
const DEPTH_GRADIENT = 0.12;    // meters depth lost per meter toward shore

const WAVE_COUNT = WAVES.length;

/** Diagonal beach depth — world coordinates */
function getDepth(x: number, z: number): number {
  const effectiveZ = z - x * SHORE_ANGLE;
  const rawDepth = DEPTH_DEEP - (effectiveZ - SHORE_Z_CENTER) * DEPTH_GRADIENT;
  return Math.max(DEPTH_SHALLOW, Math.min(DEPTH_DEEP, rawDepth));
}

/** Public depth query for gameplay */
export function getDepthAt(x: number, z: number): number {
  return getDepth(x, z);
}

/** GLSL-compatible smoothstep */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min((x - edge0) / (edge1 - edge0), 1.0));
  return t * t * (3 - 2 * t);
}

/**
 * Compute the displaced surface position at world (x, z).
 * All waves use standard Gerstner phase: k * (dir·pos - speed * time).
 * Shoaling weighted per wave. Breaking fold moves with the crest.
 */
function gerstnerDisplace(x: number, z: number, time: number): THREE.Vector3 {
  let rx = x;
  let ry = 0;
  let rz = z;

  // Pre-compute wave 0 phase for breaking (includes time — crest moves naturally)
  const k0 = (2 * Math.PI) / WAVES[0].wavelength;
  const f0 = k0 * (WAVES[0].dirX * x + WAVES[0].dirZ * z - WAVES[0].speed * time);

  for (let i = 0; i < WAVE_COUNT; i++) {
    const w = WAVES[i];
    let amplitude = w.amplitude;
    let steepness = w.steepness;

    // Shoaling: all waves, weighted (wave 0 = full, others = 30%)
    const depth = getDepth(x, z);
    const depthRatio = Math.max(depth / DEPTH_DEEP, 0.05);
    const shoalFactor = 1.0 / Math.sqrt(depthRatio);
    const shoalWeight = i === 0 ? 1.0 : 0.3;
    const effectiveShoal = 1.0 + (shoalFactor - 1.0) * shoalWeight;
    amplitude *= effectiveShoal;
    steepness *= effectiveShoal;
    steepness = Math.min(steepness, 0.4);

    // Standard Gerstner phase — ALL waves, ALL with time
    const k = (2 * Math.PI) / w.wavelength;
    const f = k * (w.dirX * x + w.dirZ * z - w.speed * time);
    const a = amplitude;
    const q = Math.max(0, Math.min(steepness / (k * a * WAVE_COUNT), 0.5));

    rx += q * a * w.dirX * Math.cos(f);
    ry += a * Math.sin(f);
    rz += q * a * w.dirZ * Math.cos(f);
  }

  // --- Breaking / Tube formation ---
  const depth = getDepth(x, z);
  const breakStrength = smoothstep(5.0, 2.0, depth);

  if (breakStrength > 0.001) {
    const sinF0 = Math.sin(f0);
    const crestFactor = smoothstep(0.0, 0.8, sinF0);
    const breakAmount = crestFactor * crestFactor * breakStrength;

    const foldAngle = breakAmount * 3.0;

    const aboveWater = Math.max(ry, 0);
    const belowWater = Math.min(ry, 0);

    ry = belowWater + aboveWater * Math.cos(foldAngle);
    rz += aboveWater * Math.sin(foldAngle);       // lip curls toward shore (+Z)

    const throwForward = breakAmount * breakAmount * aboveWater * 1.8;
    rz += throwForward;                            // throw-ahead in propagation direction
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
  shoreAngle: SHORE_ANGLE,
  shoreZCenter: SHORE_Z_CENTER,
  depthGradient: DEPTH_GRADIENT,
} as const;
