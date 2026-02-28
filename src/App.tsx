/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Canvas, useFrame } from '@react-three/fiber';
import { Sky, Trail } from '@react-three/drei';
import { useRef, useState, useEffect, useMemo } from 'react';
import * as THREE from 'three';

// --- Wave Configuration ---
const WAVE_AMPLITUDE = 3.5;       // ~10-12ft wave face — big wave for testing slope physics
const WAVE_WIDTH = 14;            // meters wide (perpendicular to crest)
const WAVE_ANGLE = Math.PI / 6;   // 30° diagonal (right-hand wave)
const WAVE_DIR_X = Math.cos(WAVE_ANGLE);
const WAVE_DIR_Z = Math.sin(WAVE_ANGLE);
const WAVE_SPEED = 3;              // m/s — wave propagation speed (conservative for a small wave)
const GRAVITY = 9.8;

// --- Starting Position (on the wave face, facing along the crest) ---
const START_WAVE_D = 2;                          // meters from peak along wave direction
const START_X = START_WAVE_D * WAVE_DIR_X;        // ~1.73
const START_Z = START_WAVE_D * WAVE_DIR_Z;        // ~1.0
const START_YAW = -WAVE_ANGLE;                    // face along the crest (rides roughly +X, -Z)

function getWaveHeight(x: number, z: number, t: number = 0): number {
  const d = x * WAVE_DIR_X + z * WAVE_DIR_Z - WAVE_SPEED * t;
  const dNorm = d / (WAVE_WIDTH / 2);
  if (Math.abs(dNorm) >= 1.0) return 0;
  return WAVE_AMPLITUDE * Math.pow(Math.cos(dNorm * Math.PI / 2), 1.5);
}

const SLOPE_EPSILON = 0.05;

function getWaveSlope(x: number, z: number, t: number = 0): { slopeX: number; slopeZ: number } {
  const hRight = getWaveHeight(x + SLOPE_EPSILON, z, t);
  const hLeft  = getWaveHeight(x - SLOPE_EPSILON, z, t);
  const hFront = getWaveHeight(x, z + SLOPE_EPSILON, t);
  const hBack  = getWaveHeight(x, z - SLOPE_EPSILON, t);
  return {
    slopeX: (hRight - hLeft) / (2 * SLOPE_EPSILON),
    slopeZ: (hFront - hBack) / (2 * SLOPE_EPSILON),
  };
}

interface PlayerProps {
  gameState: 'start' | 'playing' | 'gameover';
  setGameState: (state: 'start' | 'playing' | 'gameover') => void;
  setCrashReason: (reason: string) => void;
}

function Player({ gameState, setGameState, setCrashReason }: PlayerProps) {
  const groupRef = useRef<THREE.Group>(null);
  const clockRef = useRef(0);
  const [keys, setKeys] = useState<{ [key: string]: boolean }>({});

  // Physics state
  const stateRef = useRef({
    pitch: 0,   // Nose up/down
    roll: 0,    // Lean left/right
    yaw: START_YAW,     // Heading (along wave crest)
    cameraYaw: START_YAW, // Camera heading
    height: 0.4,// Height above wave surface
    vY: 0,      // Vertical velocity (up/down momentum)
    speed: 12,  // Start with good cruising speed
    prevPitch: 0,
    prevRoll: 0,
  });

  // Reset physics when game starts
  useEffect(() => {
    if (gameState === 'playing') {
      stateRef.current = {
        pitch: 0, roll: 0, yaw: START_YAW, cameraYaw: START_YAW,
        height: 0.4, vY: 0, speed: 12,
        prevPitch: 0, prevRoll: 0,
      };
      if (groupRef.current) {
        // Place player on the wave face wherever it currently is
        const t = clockRef.current;
        const currentD = WAVE_SPEED * t + START_WAVE_D;
        const resetX = currentD * WAVE_DIR_X;
        const resetZ = currentD * WAVE_DIR_Z;
        groupRef.current.position.set(resetX, getWaveHeight(resetX, resetZ, t) + 0.4, resetZ);
        groupRef.current.rotation.set(0, START_YAW, 0);
      }
    }
  }, [gameState]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => setKeys((k) => ({ ...k, [e.code]: true }));
    const handleKeyUp = (e: KeyboardEvent) => setKeys((k) => ({ ...k, [e.code]: false }));

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  useFrame((state, delta) => {
    clockRef.current = state.clock.elapsedTime;
    if (gameState !== 'playing' || !groupRef.current) return;

    // Cap delta to prevent physics explosions when tab is inactive
    const dt = Math.min(delta, 0.1);
    const s = stateRef.current;

    // 1. Read Input & Apply Pressure
    // Instead of holding the exact angle, we auto-center when keys are released
    let targetPitch = 0.05; // Natural slight nose-up to maintain lift
    if (keys['ArrowUp'] || keys['KeyW']) targetPitch = -0.2; // Nose down
    if (keys['ArrowDown'] || keys['KeyS']) targetPitch = 0.3; // Nose up

    let targetRoll = 0;
    if (keys['ArrowLeft'] || keys['KeyA']) targetRoll = 0.55;  // Bottom turn (up the face toward the lip)
    if (keys['ArrowRight'] || keys['KeyD']) targetRoll = -0.55; // Snap/cutback (down the face toward flat water)

    const isSnapping = keys['ShiftLeft'] || keys['ShiftRight'] || keys['Shift'];

    // Auto-pitch up slightly when snapping for visual effect and to generate the "hack" look
    if (isSnapping && Math.abs(targetRoll) > 0) {
      targetPitch = 0.25;
    }

    s.prevPitch = s.pitch;
    s.prevRoll = s.roll;

    // Pitch is responsive again, but speed generation still requires deliberate pumping
    s.pitch = THREE.MathUtils.lerp(s.pitch, targetPitch, dt * 5.0);
    s.roll = THREE.MathUtils.lerp(s.roll, targetRoll, dt * 6.0);

    // 2. Dynamic Speed (Wave Slope + Pumping)
    const pitchRate = Math.abs(s.pitch - s.prevPitch) / dt;
    const rollRate = Math.abs(s.roll - s.prevRoll) / dt;

    // Primary speed source: wave slope (gravity pulling you downhill)
    const slope = getWaveSlope(groupRef.current.position.x, groupRef.current.position.z, state.clock.elapsedTime);
    const forwardX = -Math.sin(s.yaw);
    const forwardZ = -Math.cos(s.yaw);
    const slopeInDirection = slope.slopeX * forwardX + slope.slopeZ * forwardZ;
    const waveSlopeThrust = -slopeInDirection * GRAVITY * 0.35;

    // Foil catch: foil extracts energy from the moving wave face.
    // Full effect going downhill/sideways, halved going uphill.
    const slopeMag = Math.sqrt(slope.slopeX * slope.slopeX + slope.slopeZ * slope.slopeZ);
    const uphillRatio = slopeMag > 0.001 ? Math.max(0, slopeInDirection / slopeMag) : 0;
    const foilCatchThrust = slopeMag * 1.5 * (1.0 - 0.5 * uphillRatio);

    // Secondary speed source: pumping (pitch oscillation + rail transitions)
    const pumpThrust = (pitchRate * 3.5) + (rollRate * 0.3);

    // Drag: Base drag + Stall drag + Carve drag (unchanged)
    let drag = (s.speed * 0.08) + (Math.max(0, s.pitch) * s.speed * 1.2) + (Math.abs(s.roll) * s.speed * 0.2);

    if (isSnapping && Math.abs(s.roll) > 0.1) {
      drag += s.speed * 2.5;
    }

    s.speed += (waveSlopeThrust + foilCatchThrust + pumpThrust - drag) * dt;
    if (isNaN(s.speed)) s.speed = 0;
    s.speed = THREE.MathUtils.clamp(s.speed, 1.0, 25.0);

    // 3. Vertical Physics (The Balancing Act) - WITH ASSISTS
    const baseLift = (s.speed / 10.0) * GRAVITY;
    const pitchLift = s.pitch * s.speed * 3.0;

    // GROUND EFFECT ASSIST:
    // In real life, water compresses under the board, pushing you up if you get too low.
    // If you get too high, you lose lift before breaching. This gives a "safe zone".
    let groundEffect = 0;
    if (s.height < 0.3) groundEffect = (0.3 - s.height) * 15.0; // Strong push up near water
    if (s.height > 1.0) groundEffect = -(s.height - 1.0) * 10.0; // Pull down near surface

    // WAVE FACE LIFT: On a steep face, water rushes upward and hits the foil at an angle,
    // generating extra lift. Steeper face = more lift = need to pitch down to stay level.
    const waveLift = slopeMag * GRAVITY * 0.2;

    const totalLift = baseLift + pitchLift + groundEffect + waveLift;

    s.vY += (totalLift - GRAVITY) * dt;
    s.vY *= 0.85; // Heavy dampening so it doesn't bounce wildly
    s.height += s.vY * dt;

    // 4. Crash Detection (Wipeouts) - NATURAL PHYSICS ONLY
    let crashed = false;
    let reason = "";

    if (s.height <= -0.05) { // Give a tiny bit of leeway
      crashed = true; reason = "TOUCHDOWN! Board dug into the water.";
    } else if (s.height >= 1.3) { // Increased mast height tolerance for the new 1.2m mast
      crashed = true; reason = "BREACHED! Foil wing came out of the water.";
    }
    // Artificial "STALLED" speed limit removed. 
    // If you go too slow, you just lose lift and naturally sink into a TOUCHDOWN.

    if (crashed) {
      setCrashReason(reason);
      setGameState('gameover');
      return;
    }

    // 5. Calculate Turning (Yaw)
    const snapMultiplier = isSnapping ? 2.5 : 1.0;
    const speedFactor = isSnapping ? 1.0 : (10.0 / Math.max(s.speed, 10.0));
    
    // Increased base turn rate from 3.5 to 5.5 so normal carving is much tighter
    s.yaw += s.roll * dt * 5.5 * snapMultiplier * speedFactor;

    // 6. Apply Movement & Rotations
    const forward = new THREE.Vector3(0, 0, -1);
    forward.applyAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw);
    forward.multiplyScalar(s.speed * dt);

    groupRef.current.position.add(forward);
    const waveY = getWaveHeight(groupRef.current.position.x, groupRef.current.position.z, state.clock.elapsedTime);
    groupRef.current.position.y = waveY + s.height;
    groupRef.current.rotation.set(s.pitch, s.yaw, s.roll, 'YXZ');

    // --- Camera Follow Logic (beach/drone view) ---
    // Camera on the shore side of the wave, looking back at player on the face
    // Offset is fixed relative to wave direction so the face is always visible
    const camWave = 10;  // meters toward shore (wave propagation direction)
    const camCrest = 5;  // meters ahead along crest (player's travel direction)
    const camUp = 3;     // meters above player

    const cameraOffset = new THREE.Vector3(
      camWave * WAVE_DIR_X + camCrest * WAVE_DIR_Z,
      camUp,
      camWave * WAVE_DIR_Z - camCrest * WAVE_DIR_X
    );

    const targetCameraPos = groupRef.current.position.clone().add(cameraOffset);
    state.camera.position.lerp(targetCameraPos, dt * 3);
    const lookAtTarget = groupRef.current.position.clone().add(new THREE.Vector3(0, 0.5, 0));
    state.camera.lookAt(lookAtTarget);

    // Update HUD safely
    const speedEl = document.getElementById('hud-speed');
    const heightEl = document.getElementById('hud-height');
    if (speedEl) speedEl.innerText = s.speed.toFixed(1);
    if (heightEl) heightEl.innerText = s.height.toFixed(2);
  });

  return (
    <group ref={groupRef} position={[START_X, getWaveHeight(START_X, START_Z) + 0.4, START_Z]}>
      <mesh position={[0, 0, 0]} castShadow>
        <boxGeometry args={[0.5, 0.05, 1.5]} />
        <meshStandardMaterial color="orange" />
      </mesh>
      <mesh position={[0, -0.6, -0.2]} castShadow>
        <boxGeometry args={[0.05, 1.2, 0.2]} />
        <meshStandardMaterial color="#333333" />
      </mesh>
      <mesh position={[0, -1.2, -0.2]} castShadow>
        <boxGeometry args={[0.8, 0.02, 0.2]} />
        <meshStandardMaterial color="#111111" />
      </mesh>
      <mesh position={[0, -1.2, 0.3]} castShadow>
        <boxGeometry args={[0.3, 0.02, 0.1]} />
        <meshStandardMaterial color="#111111" />
      </mesh>
      <Trail width={1} length={40} color={new THREE.Color(2, 5, 10)} attenuation={(t) => t * t} target={groupRef}>
        <mesh position={[0, -1.2, 0.3]}>
          <sphereGeometry args={[0.01]} />
          <meshBasicMaterial opacity={0} transparent />
        </mesh>
      </Trail>
    </group>
  );
}

function WaveMesh() {
  const meshRef = useRef<THREE.Mesh>(null);

  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1000, 1000, 200, 200);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, []);

  useFrame((state) => {
    if (!meshRef.current) return;
    const t = state.clock.elapsedTime;
    const posAttr = meshRef.current.geometry.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const z = posAttr.getZ(i);
      posAttr.setY(i, getWaveHeight(x, z, t));
    }
    posAttr.needsUpdate = true;
    meshRef.current.geometry.computeVertexNormals();
  });

  return (
    <mesh ref={meshRef} geometry={geometry} receiveShadow>
      <meshStandardMaterial color="#006994" side={THREE.DoubleSide} />
    </mesh>
  );
}

export default function App() {
  const [gameState, setGameState] = useState<'start' | 'playing' | 'gameover'>('start');
  const [crashReason, setCrashReason] = useState('');

  return (
    <div className="w-full h-screen bg-sky-100 relative overflow-hidden">
      <Canvas shadows camera={{ position: [0, 5, 10], fov: 50 }}>
        <Sky sunPosition={[100, 20, 100]} />
        <ambientLight intensity={0.5} />
        <directionalLight castShadow position={[10, 20, 10]} intensity={1.5} shadow-mapSize={[1024, 1024]} />
        
        <Player gameState={gameState} setGameState={setGameState} setCrashReason={setCrashReason} />

        <WaveMesh />
      </Canvas>
      
      {/* HUD */}
      {gameState === 'playing' && (
        <div className="absolute top-4 right-4 bg-slate-900/80 text-white p-4 rounded-xl shadow-md pointer-events-none font-mono min-w-[150px]">
          <div className="flex justify-between mb-1">
            <span className="text-slate-400">Speed:</span>
            <span><span id="hud-speed">12.0</span> m/s</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Height:</span>
            <span><span id="hud-height">0.40</span> m</span>
          </div>
        </div>
      )}

      {/* Start Screen */}
      {gameState === 'start' && (
        <div className="absolute inset-0 bg-slate-900/90 flex flex-col items-center justify-center text-white z-50">
          <h1 className="text-6xl font-black mb-2 tracking-tighter text-orange-500">SURF FOIL</h1>
          <p className="text-xl mb-8 text-slate-300">Master the balance of lift and gravity.</p>
          
          <div className="bg-slate-800 p-6 rounded-xl mb-8 max-w-md w-full shadow-2xl border border-slate-700">
            <h3 className="font-bold text-white mb-4 text-lg border-b border-slate-600 pb-2">How to Ride:</h3>
            <ul className="space-y-3 text-slate-300">
              <li className="flex items-start">
                <strong className="text-orange-400 w-24 shrink-0">W / Up:</strong> 
                <span>Pitch Down (Drop in, gain speed, lose lift)</span>
              </li>
              <li className="flex items-start">
                <strong className="text-orange-400 w-24 shrink-0">S / Down:</strong> 
                <span>Pitch Up (Generate lift, slow down)</span>
              </li>
              <li className="flex items-start">
                <strong className="text-orange-400 w-24 shrink-0">A / D:</strong> 
                <span>Carve Left / Right</span>
              </li>
              <li className="flex items-start">
                <strong className="text-orange-400 w-24 shrink-0">Shift:</strong> 
                <span>Hold while carving to Snap (sharp turn)</span>
              </li>
              <li className="flex items-start pt-2 border-t border-slate-700 mt-2">
                <strong className="text-sky-400 w-24 shrink-0">Pro Tip:</strong> 
                <span>Smooth rail-to-rail transitions generate speed. Don't breach or touchdown!</span>
              </li>
            </ul>
          </div>

          <button 
            onClick={() => setGameState('playing')}
            className="px-10 py-4 bg-orange-500 hover:bg-orange-400 text-white font-bold rounded-full text-xl transition-all hover:scale-105 shadow-[0_0_20px_rgba(249,115,22,0.4)]"
          >
            START RIDING
          </button>
        </div>
      )}

      {/* Game Over Screen */}
      {gameState === 'gameover' && (
        <div className="absolute inset-0 bg-red-900/95 flex flex-col items-center justify-center text-white z-50">
          <h1 className="text-7xl font-black mb-4 tracking-tighter text-red-500 drop-shadow-lg">WIPEOUT</h1>
          <p className="text-2xl mb-10 font-medium text-red-100 bg-red-950/50 px-6 py-3 rounded-lg border border-red-800/50">
            {crashReason}
          </p>
          <button 
            onClick={() => setGameState('playing')}
            className="px-10 py-4 bg-white text-red-900 hover:bg-gray-200 font-bold rounded-full text-xl transition-all hover:scale-105 shadow-xl"
          >
            TRY AGAIN
          </button>
        </div>
      )}
    </div>
  );
}
