import * as THREE from 'three';

export type GameState = 'start' | 'playing' | 'gameover';

export interface WaveParams {
  waveHeight: number;     // amplitude in meters (1.0-1.2 for 3-4ft)
  waveWidth: number;      // width of swell envelope in meters
  waveSpeed: number;      // propagation speed m/s (toward shore)
  breakSpeed: number;     // speed of breaking point along wave (X axis)
  breakStartX: number;    // starting X position of break
  curlStrength: number;   // how hollow the lip is (0-2)
  curlPower: number;      // where curl accelerates (2-3)
}

export interface WaveSample {
  height: number;         // Y position of water surface
  normal: THREE.Vector3;  // surface normal at this point
  slopeX: number;         // dY/dX (slope along wave face)
  slopeZ: number;         // dY/dZ (slope shore-to-ocean)
  foamIntensity: number;  // 0-1
}

export interface PlayerState {
  pitch: number;
  roll: number;
  yaw: number;
  cameraYaw: number;
  height: number;        // height above wave surface
  absoluteY: number;     // actual world Y position
  vY: number;
  speed: number;
  prevPitch: number;
  prevRoll: number;
  posX: number;          // world X position (along wave)
  posZ: number;          // world Z position (shore-ocean axis)
}
