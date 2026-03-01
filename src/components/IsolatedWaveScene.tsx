import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Sky } from '@react-three/drei';
import { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { getWaterSurfaceAt } from '../systems/WavePhysicsBridge';
import WaveSurface from './WaveSurface';

function TestSpheres() {
  const sphereRefs = useRef<THREE.Mesh[]>([]);
  const positions = useMemo(() => [
    [0, 0, -20],   // deep water (no shoaling, no break)
    [0, 0, 0],     // mid-depth (gentle shoaling)
    [0, 0, 15],    // break onset zone (depth ≈ 6)
    [0, 0, 28],    // mid-break (lip leaning forward)
    [0, 0, 38],    // full break (barrel forming)
  ] as [number, number, number][], []);

  const _up = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const _quat = useMemo(() => new THREE.Quaternion(), []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    sphereRefs.current.forEach((sphere, i) => {
      if (!sphere) return;
      const [x, , z] = positions[i];
      const sample = getWaterSurfaceAt(x, z, t);
      sphere.position.y = sample.height + 0.3;
      _quat.setFromUnitVectors(_up, sample.normal);
      sphere.quaternion.copy(_quat);
    });
  });

  return (
    <>
      {positions.map(([x, , z], i) => (
        <mesh
          key={i}
          ref={(el) => { if (el) sphereRefs.current[i] = el; }}
          position={[x, 0, z]}
        >
          <sphereGeometry args={[0.3, 16, 16]} />
          <meshStandardMaterial color="red" />
        </mesh>
      ))}
    </>
  );
}

export default function IsolatedWaveScene() {
  return (
    <div className="w-full h-screen bg-sky-100 relative overflow-hidden">
      <Canvas
        shadows
        camera={{ position: [30, 15, 30], fov: 50, near: 0.1, far: 500 }}
        gl={{ antialias: true }}
      >
        <Sky sunPosition={[100, 40, 60]} />
        <ambientLight intensity={0.4} />
        <directionalLight
          castShadow
          position={[50, 80, 30]}
          intensity={1.8}
          shadow-mapSize={[2048, 2048]}
        />

        <WaveSurface />
        <TestSpheres />

        <OrbitControls
          target={[0, 0, 0]}
          maxPolarAngle={Math.PI / 2.1}
          minDistance={5}
          maxDistance={100}
        />
      </Canvas>

      <div className="absolute top-4 left-4 bg-slate-900/80 text-white p-4 rounded-xl shadow-md font-mono text-sm max-w-xs">
        <h2 className="text-orange-400 font-bold text-lg mb-2">Wave Test Scene</h2>
        <p className="text-slate-300 mb-1">Orbit: Left-click + drag</p>
        <p className="text-slate-300 mb-1">Pan: Right-click + drag</p>
        <p className="text-slate-300 mb-3">Zoom: Scroll wheel</p>
        <a href="#" className="text-sky-400 hover:text-sky-300 underline">
          Back to Game
        </a>
      </div>
    </div>
  );
}
