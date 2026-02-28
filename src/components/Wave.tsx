import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { sampleWave, DEFAULT_WAVE_PARAMS } from '../systems/waveFunction';
import type { WaveParams } from '../types';

interface WaveProps {
  params?: WaveParams;
}

// Mesh resolution
const SEGMENTS_X = 80;
const SEGMENTS_Z = 40;
const SIZE_X = 120;  // meters along the wave face
const SIZE_Z = 30;   // meters shore-to-ocean

export default function Wave({ params = DEFAULT_WAVE_PARAMS }: WaveProps) {
  const meshRef = useRef<THREE.Mesh>(null);

  // Create geometry once, update vertices each frame
  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(SIZE_X, SIZE_Z, SEGMENTS_X, SEGMENTS_Z);
    // Rotate so the plane lies in XZ (horizontal), with Y as height
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, []);

  useFrame((state) => {
    if (!meshRef.current) return;

    const geo = meshRef.current.geometry;
    const posAttr = geo.attributes.position;
    const time = state.clock.elapsedTime;

    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const z = posAttr.getZ(i);

      const sample = sampleWave(x, z, time, params);
      posAttr.setY(i, sample.height);
    }

    posAttr.needsUpdate = true;
    geo.computeVertexNormals();
  });

  return (
    <mesh ref={meshRef} geometry={geometry} receiveShadow>
      <meshStandardMaterial
        color="#0e7a6b"
        side={THREE.DoubleSide}
        flatShading={false}
      />
    </mesh>
  );
}
