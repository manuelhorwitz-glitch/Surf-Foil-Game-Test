import { useRef, useMemo, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { Trail } from '@react-three/drei';
import * as THREE from 'three';
import { sampleWave, DEFAULT_WAVE_PARAMS } from '../systems/waveFunction';
import type { GameState, WaveParams, PlayerState } from '../types';

interface PlayerProps {
  gameState: GameState;
  setGameState: (state: GameState) => void;
  setCrashReason: (reason: string) => void;
  waveParams?: WaveParams;
  groupRef: React.RefObject<THREE.Group | null>;
}

// Starting position: on the wave face, slightly behind the peak
const START_X = 0;
const START_Z = 2;       // on the wave face (positive Z = toward shore from peak)
const START_SPEED = 8;
const START_YAW = Math.PI / 2;  // facing +X (along the wave face)

function createInitialState(): PlayerState {
  const waveSample = sampleWave(START_X, START_Z, 0, DEFAULT_WAVE_PARAMS);
  return {
    pitch: 0,
    roll: 0,
    yaw: START_YAW,
    cameraYaw: START_YAW,
    height: 0.4,                            // height above wave surface
    absoluteY: waveSample.height + 0.4,     // actual world Y
    vY: 0,
    speed: START_SPEED,
    prevPitch: 0,
    prevRoll: 0,
    posX: START_X,
    posZ: START_Z,
  };
}

export default function Player({ gameState, setGameState, setCrashReason, waveParams = DEFAULT_WAVE_PARAMS, groupRef }: PlayerProps) {
  const [keys, setKeys] = useState<{ [key: string]: boolean }>({});
  const stateRef = useRef<PlayerState>(createInitialState());

  // Reset physics when game starts
  useEffect(() => {
    if (gameState === 'playing') {
      stateRef.current = createInitialState();
      if (groupRef.current) {
        const s = stateRef.current;
        groupRef.current.position.set(s.posX, s.absoluteY, s.posZ);
        groupRef.current.rotation.set(0, s.yaw, 0);
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

  useFrame((_, delta) => {
    if (gameState !== 'playing' || !groupRef.current) return;

    const dt = Math.min(delta, 0.1);
    const s = stateRef.current;
    const time = 0; // Phase 1: static wave (time doesn't affect wave shape yet)

    // --- 1. Input ---
    let targetPitch = 0.05;
    if (keys['ArrowUp'] || keys['KeyW']) targetPitch = -0.2;
    if (keys['ArrowDown'] || keys['KeyS']) targetPitch = 0.3;

    let targetRoll = 0;
    if (keys['ArrowLeft'] || keys['KeyA']) targetRoll = 0.55;
    if (keys['ArrowRight'] || keys['KeyD']) targetRoll = -0.55;

    const isSnapping = keys['ShiftLeft'] || keys['ShiftRight'] || keys['Shift'];
    if (isSnapping && Math.abs(targetRoll) > 0) {
      targetPitch = 0.25;
    }

    s.prevPitch = s.pitch;
    s.prevRoll = s.roll;
    s.pitch = THREE.MathUtils.lerp(s.pitch, targetPitch, dt * 5.0);
    s.roll = THREE.MathUtils.lerp(s.roll, targetRoll, dt * 6.0);

    // --- 2. Sample wave at player position ---
    const waveSample = sampleWave(s.posX, s.posZ, time, waveParams);
    const surfaceY = waveSample.height;

    // --- 3. Speed: wave slope + pumping ---
    const pitchRate = Math.abs(s.pitch - s.prevPitch) / dt;
    const rollRate = Math.abs(s.roll - s.prevRoll) / dt;

    // Thrust from pumping (secondary on the wave — slope is primary)
    const pumpThrust = (pitchRate * 3.0) + (rollRate * 0.3);

    // Wave slope thrust: project slope onto player's movement direction
    // Negative slope in travel direction = going downhill = gain speed
    const forwardX = Math.sin(s.yaw);
    const forwardZ = -Math.cos(s.yaw);
    const slopeInDirection = waveSample.slopeX * forwardX + waveSample.slopeZ * forwardZ;
    const gravity = 9.8;
    const waveSlopeThrust = -slopeInDirection * gravity * 0.8;

    // Drag
    let drag = (s.speed * 0.06) +
      (Math.max(0, s.pitch) * s.speed * 1.0) +
      (Math.abs(s.roll) * s.speed * 0.15);

    if (isSnapping && Math.abs(s.roll) > 0.1) {
      drag += s.speed * 2.0;
    }

    s.speed += (pumpThrust + waveSlopeThrust - drag) * dt;
    if (isNaN(s.speed)) s.speed = 0;
    s.speed = THREE.MathUtils.clamp(s.speed, 1.0, 25.0);

    // --- 4. Vertical physics (height above wave surface) ---
    const baseLift = (s.speed / 10.0) * gravity;
    const pitchLift = s.pitch * s.speed * 3.0;

    let groundEffect = 0;
    if (s.height < 0.3) groundEffect = (0.3 - s.height) * 15.0;
    if (s.height > 1.0) groundEffect = -(s.height - 1.0) * 10.0;

    const totalLift = baseLift + pitchLift + groundEffect;
    s.vY += (totalLift - gravity) * dt;
    s.vY *= 0.85;
    s.height += s.vY * dt;

    // --- 5. Crash detection (relative to wave surface) ---
    let crashed = false;
    let reason = '';

    if (s.height <= -0.05) {
      crashed = true;
      reason = 'TOUCHDOWN! Board dug into the water.';
    } else if (s.height >= 1.3) {
      crashed = true;
      reason = 'BREACHED! Foil wing came out of the water.';
    }

    if (crashed) {
      setCrashReason(reason);
      setGameState('gameover');
      return;
    }

    // --- 6. Turning (yaw) ---
    const snapMultiplier = isSnapping ? 2.5 : 1.0;
    const speedFactor = isSnapping ? 1.0 : (10.0 / Math.max(s.speed, 10.0));
    s.yaw += s.roll * dt * 5.5 * snapMultiplier * speedFactor;

    // --- 7. Apply movement ---
    const moveX = Math.sin(s.yaw) * s.speed * dt;
    const moveZ = -Math.cos(s.yaw) * s.speed * dt;
    s.posX += moveX;
    s.posZ += moveZ;

    // Absolute Y = wave surface + height above it
    s.absoluteY = surfaceY + s.height;

    groupRef.current.position.set(s.posX, s.absoluteY, s.posZ);
    groupRef.current.rotation.set(s.pitch, s.yaw, s.roll, 'YXZ');

    // --- 8. Update HUD ---
    const speedEl = document.getElementById('hud-speed');
    const heightEl = document.getElementById('hud-height');
    if (speedEl) speedEl.innerText = s.speed.toFixed(1);
    if (heightEl) heightEl.innerText = s.height.toFixed(2);
  });

  // Board shape: pointed nose (-Z is forward), wider tail (+Z is back)
  const boardShape = useMemo(() => {
    const shape = new THREE.Shape();
    // Start at tail-left, go clockwise
    // Tail (wide, flat) at z=+0.6
    shape.moveTo(-0.25, 0.6);
    // Left rail
    shape.lineTo(-0.28, 0.3);
    shape.lineTo(-0.22, -0.2);
    // Nose (pointed) at z=-0.75
    shape.lineTo(0, -0.75);
    // Right rail
    shape.lineTo(0.22, -0.2);
    shape.lineTo(0.28, 0.3);
    // Back to tail-right
    shape.lineTo(0.25, 0.6);
    shape.lineTo(-0.25, 0.6);
    return shape;
  }, []);

  return (
    <group ref={groupRef} position={[START_X, 0.4, START_Z]}>
      {/* Board — extruded surfboard shape */}
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} castShadow>
        <extrudeGeometry args={[boardShape, { depth: 0.05, bevelEnabled: false }]} />
        <meshStandardMaterial color="orange" />
      </mesh>
      {/* Nose tip marker — bright red so you always know which way is forward */}
      <mesh position={[0, 0.02, -0.7]} castShadow>
        <sphereGeometry args={[0.06]} />
        <meshStandardMaterial color="#ff2222" />
      </mesh>
      {/* Mast */}
      <mesh position={[0, -0.6, -0.2]} castShadow>
        <boxGeometry args={[0.05, 1.2, 0.2]} />
        <meshStandardMaterial color="#333333" />
      </mesh>
      {/* Front foil wing */}
      <mesh position={[0, -1.2, -0.2]} castShadow>
        <boxGeometry args={[0.8, 0.02, 0.2]} />
        <meshStandardMaterial color="#111111" />
      </mesh>
      {/* Rear stabilizer */}
      <mesh position={[0, -1.2, 0.3]} castShadow>
        <boxGeometry args={[0.3, 0.02, 0.1]} />
        <meshStandardMaterial color="#111111" />
      </mesh>
      {/* Trail effect */}
      <Trail width={1} length={40} color={new THREE.Color(2, 5, 10)} attenuation={(t) => t * t} target={groupRef}>
        <mesh position={[0, -1.2, 0.3]}>
          <sphereGeometry args={[0.01]} />
          <meshBasicMaterial opacity={0} transparent />
        </mesh>
      </Trail>
    </group>
  );
}
