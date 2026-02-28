import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { GameState } from '../types';

interface CameraProps {
  gameState: GameState;
  playerRef: React.RefObject<THREE.Group | null>;
}

// Chase camera config (same feel as the original prototype)
const CAMERA_CONFIG = {
  heightOffset: 2.5,    // how far above the player
  distanceBehind: 6,    // how far behind the player
  followSpeed: 5,       // how quickly the camera follows position
  yawLerpSpeed: 2.5,    // how quickly camera rotation catches up
  fov: 50,
};

export default function Camera({ gameState, playerRef }: CameraProps) {
  const { camera } = useThree();
  const cameraYaw = useRef(0);

  // Set FOV on mount
  useFrame(() => {
    if (camera instanceof THREE.PerspectiveCamera && camera.fov !== CAMERA_CONFIG.fov) {
      camera.fov = CAMERA_CONFIG.fov;
      camera.updateProjectionMatrix();
    }
  });

  useFrame((_, delta) => {
    if (gameState !== 'playing' || !playerRef.current) return;

    const dt = Math.min(delta, 0.1);
    const playerPos = playerRef.current.position;
    const playerYaw = playerRef.current.rotation.y;

    // Smoothly track the player's yaw
    cameraYaw.current = THREE.MathUtils.lerp(cameraYaw.current, playerYaw, dt * CAMERA_CONFIG.yawLerpSpeed);

    // Compute camera offset behind the player based on their heading
    const offset = new THREE.Vector3(0, CAMERA_CONFIG.heightOffset, CAMERA_CONFIG.distanceBehind);
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), cameraYaw.current);

    const targetCameraPos = playerPos.clone().add(offset);
    camera.position.lerp(targetCameraPos, dt * CAMERA_CONFIG.followSpeed);

    // Look at the player with a slight upward offset
    const lookTarget = playerPos.clone().add(new THREE.Vector3(0, 0.5, 0));
    camera.lookAt(lookTarget);
  });

  return null;
}
