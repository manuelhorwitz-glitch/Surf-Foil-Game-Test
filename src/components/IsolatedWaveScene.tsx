import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Sky } from '@react-three/drei';
import { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { getWaterSurfaceAt } from '../systems/WavePhysicsBridge';
import WaveSurface from './WaveSurface';

function TestSpheres() {
  const sphereRefs = useRef<THREE.Mesh[]>([]);
  // Fixed world positions spread across the depth gradient
  const positions = useMemo(() => [
    [0, -20],    // deep water (no shoaling)
    [0, 0],      // mid-depth
    [0, 20],     // approaching shallow zone
    [0, 35],     // shallow / break zone
    [20, 10],    // offset +X to show diagonal effect (deeper here)
    [-20, 20],   // offset -X (shallower here — breaks first)
  ] as [number, number][], []);

  const _up = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const _quat = useMemo(() => new THREE.Quaternion(), []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    sphereRefs.current.forEach((sphere, i) => {
      if (!sphere) return;
      const [x, z] = positions[i];
      const sample = getWaterSurfaceAt(x, z, t);
      sphere.position.set(x, sample.height + 0.3, z);
      _quat.setFromUnitVectors(_up, sample.normal);
      sphere.quaternion.copy(_quat);
    });
  });

  return (
    <>
      {positions.map((_, i) => (
        <mesh
          key={i}
          ref={(el) => { if (el) sphereRefs.current[i] = el; }}
          position={[0, 0, 0]}
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
        camera={{ position: [40, 20, 40], fov: 50, near: 0.1, far: 500 }}
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

        <WaveSurface size={120} segments={256} />
        <TestSpheres />

        <OrbitControls
          target={[0, 0, 15]}
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
