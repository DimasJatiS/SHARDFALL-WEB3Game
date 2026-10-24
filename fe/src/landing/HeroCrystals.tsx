// Fase 2: three floating neon shards behind the hero. Loaded lazily (see Landing.tsx).
// Rendering stops whenever the hero is off-screen or the tab is hidden, and draws a
// single still frame for prefers-reduced-motion.

import { Float } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";

/** Pointer in -1..1, tracked on window because the canvas sits under the hero text. */
const pointer = { x: 0, y: 0 };

// Placed around the edges and in the gap between the copy and the key art,
// so they never sit behind the headline.
const SHARDS = [
  { position: [6.2, 1.5, -2.5], scale: 1.1, color: "#b06bff", speed: 1.2 },
  { position: [-0.5, 2.1, -1], scale: 0.42, color: "#3ee6ff", speed: 1.8 },
  { position: [0.1, -2.6, 0], scale: 0.55, color: "#d3a6ff", speed: 1.5 },
] as const;

export default function HeroCrystals() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  const [reduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  useEffect(() => {
    const el = ref.current!;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0 });
    io.observe(el);
    const onMove = (e: PointerEvent) => {
      pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    const onVis = () => setVisible(!document.hidden && el.getBoundingClientRect().bottom > 0);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("visibilitychange", onVis);
    return () => {
      io.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return (
    <div ref={ref} className="lp-crystals" aria-hidden>
      <Canvas
        // "never" pauses useFrame entirely while the hero is scrolled away.
        frameloop={reduced ? "demand" : visible ? "always" : "never"}
        dpr={[1, 1.5]}
        camera={{ position: [0, 0, 9], fov: 40 }}
        gl={{ alpha: true, antialias: true, powerPreference: "low-power" }}
      >
        <ambientLight intensity={0.25} />
        <pointLight position={[5, 4, 6]} color="#b06bff" intensity={80} />
        <pointLight position={[-6, -3, 5]} color="#3ee6ff" intensity={50} />
        <Parallax>
          {SHARDS.map((s, i) => (
            <Float key={i} speed={reduced ? 0 : s.speed} rotationIntensity={0.8} floatIntensity={1.2}>
              <Shard position={s.position} scale={s.scale} color={s.color} />
            </Float>
          ))}
        </Parallax>
      </Canvas>
    </div>
  );
}

function Parallax({ children }: { children: ReactNode }) {
  const group = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    const k = 1 - Math.exp(-dt * 3);
    g.rotation.y += (pointer.x * 0.35 - g.rotation.y) * k;
    g.rotation.x += (pointer.y * 0.2 - g.rotation.x) * k;
  });
  return <group ref={group}>{children}</group>;
}

function Shard({ position, scale, color }: { position: readonly [number, number, number]; scale: number; color: string }) {
  const mesh = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (mesh.current) mesh.current.rotation.y += dt * 0.25;
  });
  return (
    <group position={position} scale={scale}>
      <mesh ref={mesh}>
        <icosahedronGeometry args={[1, 0]} />
        <meshStandardMaterial
          color="#2a1850"
          emissive={color}
          emissiveIntensity={0.18}
          roughness={0.35}
          metalness={0.3}
          flatShading
        />
      </mesh>
      {/* Neon edges */}
      <mesh scale={1.02}>
        <icosahedronGeometry args={[1, 0]} />
        <meshBasicMaterial color={color} wireframe transparent opacity={0.55} toneMapped={false} />
      </mesh>
    </group>
  );
}
