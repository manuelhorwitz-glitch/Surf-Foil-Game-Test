/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Canvas, useFrame } from '@react-three/fiber';
import { Sky, Trail } from '@react-three/drei';
import { useRef, useState, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import IsolatedWaveScene from './components/IsolatedWaveScene';
import WaveSurface from './components/WaveSurface';
import { getWaveHeightAt, getWaveSlopeAt } from './systems/WavePhysicsBridge';

// --- Wave Direction (from Gerstner primary wave: propagates +Z) ---
const WAVE_DIR_X = 0;
const WAVE_DIR_Z = 1;
const GRAVITY = 9.8;

// --- Starting Position (pocket: just ahead of the peeling break) ---
const START_X = 5;
const START_Z = 20;
const START_YAW = -Math.PI / 2;  // face +X (riding along the crest)

// --- Spray System ---
const SPRAY_POOL_SIZE = 100;
const _sprayOffset = new THREE.Vector3();
const _sprayVel = new THREE.Vector3();

interface SprayState {
  roll: number;
  height: number;
  speed: number;
  rollRate: number;
  isSnapping: boolean;
  isPlaying: boolean;
}

interface PlayerProps {
  gameState: 'start' | 'playing' | 'gameover';
  setGameState: (state: 'start' | 'playing' | 'gameover') => void;
  setCrashReason: (reason: string) => void;
  playerGroupRef: React.RefObject<THREE.Group | null>;
  sprayStateRef: React.RefObject<SprayState>;
}

function Player({ gameState, setGameState, setCrashReason, playerGroupRef, sprayStateRef }: PlayerProps) {
  const groupRef = playerGroupRef;
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
        const t = clockRef.current;
        groupRef.current.position.set(START_X, getWaveHeightAt(START_X, START_Z, t) + 0.4, START_Z);
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
    if (gameState !== 'playing' || !groupRef.current) {
      sprayStateRef.current.isPlaying = false;
      return;
    }

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
    const slope = getWaveSlopeAt(groupRef.current.position.x, groupRef.current.position.z, state.clock.elapsedTime);
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
      sprayStateRef.current.isPlaying = false;
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
    const waveY = getWaveHeightAt(groupRef.current.position.x, groupRef.current.position.z, state.clock.elapsedTime);
    groupRef.current.position.y = waveY + s.height;
    groupRef.current.rotation.set(s.pitch, s.yaw, s.roll, 'YXZ');

    // Write spray state for SprayParticles
    const ss = sprayStateRef.current;
    ss.roll = s.roll;
    ss.height = s.height;
    ss.speed = s.speed;
    ss.rollRate = rollRate;
    ss.isSnapping = isSnapping;
    ss.isPlaying = true;

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
    <group ref={groupRef} position={[START_X, getWaveHeightAt(START_X, START_Z, 0) + 0.4, START_Z]}>
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

interface SprayProps {
  playerGroupRef: React.RefObject<THREE.Group | null>;
  sprayStateRef: React.RefObject<SprayState>;
}

function SprayParticles({ playerGroupRef, sprayStateRef }: SprayProps) {
  const pointsRef = useRef<THREE.Points>(null);

  const pool = useMemo(() => ({
    positions: new Float32Array(SPRAY_POOL_SIZE * 3),
    velocities: new Float32Array(SPRAY_POOL_SIZE * 3),
    sizes: new Float32Array(SPRAY_POOL_SIZE),
    opacities: new Float32Array(SPRAY_POOL_SIZE),
    lives: new Float32Array(SPRAY_POOL_SIZE),
    maxLives: new Float32Array(SPRAY_POOL_SIZE),
    baseSizes: new Float32Array(SPRAY_POOL_SIZE),
    nextSlot: 0,
    accRail: 0, accMast: 0, accFoil: 0, accSnap: 0,
  }), []);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pool.positions, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(pool.sizes, 1));
    geo.setAttribute('aOpacity', new THREE.BufferAttribute(pool.opacities, 1));
    return geo;
  }, [pool]);

  const material = useMemo(() => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute float aSize;
      attribute float aOpacity;
      varying float vOpacity;
      void main() {
        vOpacity = aOpacity;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * (200.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying float vOpacity;
      void main() {
        float dist = length(gl_PointCoord - vec2(0.5));
        if (dist > 0.5) discard;
        float alpha = vOpacity * smoothstep(0.5, 0.2, dist);
        gl_FragColor = vec4(1.0, 1.0, 1.0, alpha);
      }
    `,
  }), []);

  useFrame((_, delta) => {
    const group = playerGroupRef.current;
    const ss = sprayStateRef.current;
    if (!group || !ss.isPlaying) return;

    const dt = Math.min(delta, 0.1);
    const p = pool;

    // --- Update existing particles ---
    for (let i = 0; i < SPRAY_POOL_SIZE; i++) {
      if (p.lives[i] <= 0) continue;
      p.lives[i] -= dt;
      if (p.lives[i] <= 0) {
        p.opacities[i] = 0;
        p.sizes[i] = 0;
        continue;
      }
      const i3 = i * 3;
      p.velocities[i3 + 1] -= 9.8 * dt;          // gravity
      p.velocities[i3] *= (1 - 1.5 * dt);         // air drag X
      p.velocities[i3 + 1] *= (1 - 1.0 * dt);     // air drag Y (less, so it arcs)
      p.velocities[i3 + 2] *= (1 - 1.5 * dt);     // air drag Z
      p.positions[i3] += p.velocities[i3] * dt;
      p.positions[i3 + 1] += p.velocities[i3 + 1] * dt;
      p.positions[i3 + 2] += p.velocities[i3 + 2] * dt;
      const lifeRatio = p.lives[i] / p.maxLives[i];
      p.opacities[i] = lifeRatio * lifeRatio * 0.6;
      p.sizes[i] = p.baseSizes[i] * (0.5 + 0.5 * lifeRatio);
      if (p.positions[i3 + 1] < -0.5) {
        p.lives[i] = 0;
        p.opacities[i] = 0;
        p.sizes[i] = 0;
      }
    }

    // --- Spawn helpers ---
    const absRoll = Math.abs(ss.roll);
    const railSide = Math.sign(ss.roll) || 1;
    const quat = group.quaternion;
    const pos = group.position;

    function findSlot(): number {
      for (let j = 0; j < SPRAY_POOL_SIZE; j++) {
        const idx = (p.nextSlot + j) % SPRAY_POOL_SIZE;
        if (p.lives[idx] <= 0) {
          p.nextSlot = (idx + 1) % SPRAY_POOL_SIZE;
          return idx;
        }
      }
      return -1;
    }

    function spawn(lx: number, ly: number, lz: number,
                   vx: number, vy: number, vz: number,
                   size: number, life: number) {
      const idx = findSlot();
      if (idx < 0) return;
      const i3 = idx * 3;
      _sprayOffset.set(lx, ly, lz).applyQuaternion(quat);
      p.positions[i3] = pos.x + _sprayOffset.x;
      p.positions[i3 + 1] = pos.y + _sprayOffset.y;
      p.positions[i3 + 2] = pos.z + _sprayOffset.z;
      _sprayVel.set(vx, vy, vz).applyQuaternion(quat);
      p.velocities[i3] = _sprayVel.x;
      p.velocities[i3 + 1] = _sprayVel.y;
      p.velocities[i3 + 2] = _sprayVel.z;
      p.baseSizes[idx] = size;
      p.sizes[idx] = size;
      p.opacities[idx] = 0.6;
      p.lives[idx] = life;
      p.maxLives[idx] = life;
    }

    // --- Rail spray: carving + low height ---
    if (absRoll > 0.15 && ss.height < 0.5 && ss.speed > 4) {
      p.accRail += absRoll * ss.speed * 3 * dt;
      while (p.accRail >= 1) {
        const spd = ss.speed * 0.15;
        spawn(
          -railSide * 0.25, -0.02, 0.1,
          -railSide * (1.5 + Math.random() * 0.5) * spd,
          (1.0 + Math.random() * 0.5) * spd,
          (0.3 + Math.random() * 0.2) * spd,
          0.3 + Math.random() * 0.2,
          0.6 + Math.random() * 0.4
        );
        p.accRail -= 1;
      }
    } else { p.accRail = 0; }

    // --- Mast spray: radical fast turns ---
    if (ss.rollRate > 1.5 && absRoll > 0.3 && ss.speed > 8) {
      p.accMast += 6 * dt;
      while (p.accMast >= 1) {
        const spd = ss.speed * 0.08;
        spawn(
          0, -0.6, -0.2,
          -railSide * (0.8 + Math.random() * 0.3) * spd,
          (0.3 + Math.random() * 0.3) * spd,
          (-0.5 + Math.random() * 1.0) * spd,
          0.2 + Math.random() * 0.2,
          0.4 + Math.random() * 0.3
        );
        p.accMast -= 1;
      }
    } else { p.accMast = 0; }

    // --- Foil breach spray: wing tip near surface during hard carve ---
    const wingTipRise = Math.sin(absRoll) * 0.4;
    const foilTipHeight = ss.height - 1.2 + wingTipRise;
    if (foilTipHeight > -0.3 && absRoll > 0.35 && ss.speed > 6) {
      p.accFoil += 4 * dt;
      while (p.accFoil >= 1) {
        spawn(
          railSide * 0.4, -1.2, -0.2,
          railSide * (0.5 + Math.random() * 0.3) * 0.5,
          (2.0 + Math.random() * 1.0) * 0.5,
          (Math.random() * 0.5 - 0.25) * 0.5,
          0.8 + Math.random() * 0.4,
          0.3 + Math.random() * 0.2
        );
        p.accFoil -= 1;
      }
    } else { p.accFoil = 0; }

    // --- Snap spray: dense concentrated ---
    if (ss.isSnapping && absRoll > 0.2 && ss.speed > 3) {
      p.accSnap += 35 * dt;
      while (p.accSnap >= 1) {
        const spd = ss.speed * 0.12;
        spawn(
          -railSide * 0.25, -0.02, 0.1,
          -railSide * (1.0 + Math.random() * 0.8) * spd,
          (0.5 + Math.random() * 0.3) * spd,
          (0.8 + Math.random() * 0.5) * spd,
          0.4 + Math.random() * 0.2,
          0.4 + Math.random() * 0.4
        );
        p.accSnap -= 1;
      }
    } else { p.accSnap = 0; }

    // --- Upload to GPU ---
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.aSize.needsUpdate = true;
    geometry.attributes.aOpacity.needsUpdate = true;
  });

  return (
    <points ref={pointsRef} frustumCulled={false} geometry={geometry} material={material} />
  );
}

export default function App() {
  const [sceneMode, setSceneMode] = useState<'game' | 'wave-test'>(() => {
    return window.location.hash === '#wave-test' ? 'wave-test' : 'game';
  });

  useEffect(() => {
    const onHashChange = () => {
      setSceneMode(window.location.hash === '#wave-test' ? 'wave-test' : 'game');
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  if (sceneMode === 'wave-test') {
    return <IsolatedWaveScene />;
  }

  return <GameScene />;
}

function GameScene() {
  const [gameState, setGameState] = useState<'start' | 'playing' | 'gameover'>('start');
  const [crashReason, setCrashReason] = useState('');
  const playerGroupRef = useRef<THREE.Group>(null);
  const sprayStateRef = useRef<SprayState>({
    roll: 0, height: 0.4, speed: 12,
    rollRate: 0, isSnapping: false, isPlaying: false,
  });

  return (
    <div className="w-full h-screen bg-sky-100 relative overflow-hidden">
      <Canvas shadows camera={{ position: [0, 5, 10], fov: 50 }}>
        <Sky sunPosition={[100, 40, 60]} />
        <ambientLight intensity={0.4} />
        <directionalLight castShadow position={[50, 80, 30]} intensity={1.8} shadow-mapSize={[2048, 2048]} />

        <Player gameState={gameState} setGameState={setGameState} setCrashReason={setCrashReason} playerGroupRef={playerGroupRef} sprayStateRef={sprayStateRef} />
        <SprayParticles playerGroupRef={playerGroupRef} sprayStateRef={sprayStateRef} />

        <WaveSurface size={400} segments={512} />
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
