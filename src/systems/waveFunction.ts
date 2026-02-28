import * as THREE from 'three';
import type { WaveParams, WaveSample } from '../types';

// Default wave parameters for a small, fun 3-4ft wave
export const DEFAULT_WAVE_PARAMS: WaveParams = {
  waveHeight: 1.2,       // ~3-4ft face
  waveWidth: 10,         // width of the swell envelope
  waveSpeed: 0,          // static for Phase 1 (will add propagation in Phase 2)
  breakSpeed: 0,         // no breaking yet
  breakStartX: 0,
  curlStrength: 0,       // no lip curl yet
  curlPower: 2,
};

// Small epsilon for numerical slope computation
const EPSILON = 0.05;

// Reusable vector to avoid allocations in hot loop
const _normal = new THREE.Vector3();

/**
 * Compute the raw wave height at a given (x, z) position.
 * Phase 1: Simple cosine envelope in Z direction.
 * The wave is a hump centered at z=0, extending in the X direction (along the face).
 */
function computeHeight(x: number, z: number, time: number, params: WaveParams): number {
  const { waveHeight, waveWidth, waveSpeed } = params;

  // Wave propagation (Phase 2 — currently waveSpeed=0 so this is static)
  const zEffective = z - waveSpeed * time;

  // Cosine envelope: wave shape in Z (shore-to-ocean cross-section)
  // Normalized so the peak is at z=0, falls to zero at z = ±waveWidth/2
  const zNorm = zEffective / (waveWidth / 2);

  if (Math.abs(zNorm) >= 1.0) {
    return 0; // Outside the wave envelope
  }

  // Raised cosine profile — pow(cos, 1.5) gives a natural peaked shape
  const envelope = Math.pow(Math.cos(zNorm * Math.PI / 2), 1.5);

  return waveHeight * envelope;
}

/**
 * Sample the wave at a given world position.
 * Returns height, surface normal, slopes, and foam intensity.
 * This is the core function shared by rendering (Wave.tsx) and physics (Player.tsx).
 */
export function sampleWave(x: number, z: number, time: number, params: WaveParams): WaveSample {
  const height = computeHeight(x, z, time, params);

  // Compute slopes via finite differences (fast and robust)
  const hLeft = computeHeight(x - EPSILON, z, time, params);
  const hRight = computeHeight(x + EPSILON, z, time, params);
  const hBack = computeHeight(x, z - EPSILON, time, params);
  const hFront = computeHeight(x, z + EPSILON, time, params);

  const slopeX = (hRight - hLeft) / (2 * EPSILON);
  const slopeZ = (hFront - hBack) / (2 * EPSILON);

  // Surface normal from slopes: n = normalize(-dH/dx, 1, -dH/dz)
  _normal.set(-slopeX, 1, -slopeZ).normalize();

  return {
    height,
    normal: _normal.clone(),
    slopeX,
    slopeZ,
    foamIntensity: 0, // No foam in Phase 1
  };
}
