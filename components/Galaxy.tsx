"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { Verse } from "@/lib/types";

const GALAXY_SCALE = 32;

const MECCAN_COLOR = new THREE.Color("#6e8cff");
const MECCAN_COLOR_2 = new THREE.Color("#b76eff");
const MEDINAN_COLOR = new THREE.Color("#ffb347");
const MEDINAN_COLOR_2 = new THREE.Color("#ff8c42");

interface GalaxyProps {
  verses: Verse[];
  matchedIds: Set<number>;
  onSelectVerse: (v: Verse) => void;
}

export function Galaxy({ verses, matchedIds, onSelectVerse }: GalaxyProps) {
  return (
    <div className="fixed inset-0 z-0">
      <Canvas
        camera={{ position: [0, 0, 60], fov: 55, near: 0.1, far: 500 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
      >
        <color attach="background" args={["#020308"]} />
        <ambientLight intensity={0.2} />
        <ParticleField verses={verses} matchedIds={matchedIds} onSelectVerse={onSelectVerse} />
        <OrbitControls
          enablePan={false}
          enableZoom={true}
          minDistance={15}
          maxDistance={120}
          zoomSpeed={0.6}
          rotateSpeed={0.35}
          autoRotate={matchedIds.size === 0}
          autoRotateSpeed={0.15}
        />
      </Canvas>
    </div>
  );
}

function ParticleField({
  verses,
  matchedIds,
  onSelectVerse,
}: {
  verses: Verse[];
  matchedIds: Set<number>;
  onSelectVerse: (v: Verse) => void;
}) {
  const pointsRef = useRef<THREE.Points>(null!);
  const { camera, raycaster, pointer, size } = useThree();
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  // Build geometry
  const { geometry, colors, baseSizes } = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(verses.length * 3);
    const cols = new Float32Array(verses.length * 3);
    const sizes = new Float32Array(verses.length);
    const ids = new Uint32Array(verses.length);

    for (let i = 0; i < verses.length; i++) {
      const v = verses[i];
      positions[i * 3 + 0] = v.x * GALAXY_SCALE;
      positions[i * 3 + 1] = v.y * GALAXY_SCALE;
      positions[i * 3 + 2] = v.z * GALAXY_SCALE;

      // Color based on revelation type, jittered by cluster for variety
      const t = (Math.abs(Math.sin(v.cluster * 1.13)) + 1) * 0.5;
      const c =
        v.revelationType === "Meccan"
          ? MECCAN_COLOR.clone().lerp(MECCAN_COLOR_2, t)
          : MEDINAN_COLOR.clone().lerp(MEDINAN_COLOR_2, t);
      cols[i * 3 + 0] = c.r;
      cols[i * 3 + 1] = c.g;
      cols[i * 3 + 2] = c.b;

      sizes[i] = 1.0;
      ids[i] = v.id;
    }

    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    return { geometry: geo, colors: cols, baseSizes: sizes };
  }, [verses]);

  // Update opacity / size based on matched
  useEffect(() => {
    const sizeAttr = geometry.getAttribute("aSize") as THREE.BufferAttribute;
    const colorAttr = geometry.getAttribute("color") as THREE.BufferAttribute;
    const hasMatches = matchedIds.size > 0;
    for (let i = 0; i < verses.length; i++) {
      const v = verses[i];
      const isMatched = matchedIds.has(v.id);
      // Size
      sizeAttr.array[i] = hasMatches ? (isMatched ? 2.6 : 0.6) : baseSizes[i];
      // Color — dim non-matches
      const r = colors[i * 3 + 0];
      const g = colors[i * 3 + 1];
      const b = colors[i * 3 + 2];
      if (hasMatches && !isMatched) {
        colorAttr.array[i * 3 + 0] = r * 0.15;
        colorAttr.array[i * 3 + 1] = g * 0.15;
        colorAttr.array[i * 3 + 2] = b * 0.15;
      } else if (hasMatches && isMatched) {
        // brighten matched to near-white
        colorAttr.array[i * 3 + 0] = Math.min(1, r * 1.8 + 0.3);
        colorAttr.array[i * 3 + 1] = Math.min(1, g * 1.8 + 0.3);
        colorAttr.array[i * 3 + 2] = Math.min(1, b * 1.8 + 0.3);
      } else {
        colorAttr.array[i * 3 + 0] = r;
        colorAttr.array[i * 3 + 1] = g;
        colorAttr.array[i * 3 + 2] = b;
      }
    }
    sizeAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
  }, [matchedIds, verses, geometry, colors, baseSizes]);

  // Breathing pulse + rotation handled by autoRotate on controls
  useFrame((state) => {
    if (!pointsRef.current) return;
    const mat = pointsRef.current.material as THREE.ShaderMaterial;
    if (mat.uniforms?.uTime) mat.uniforms.uTime.value = state.clock.elapsedTime;
  });

  // Click detection via raycaster
  const handlePointerDown = (event: THREE.Event) => {
    raycaster.setFromCamera(pointer, camera);
    raycaster.params.Points = { threshold: 0.5 };
    if (!pointsRef.current) return;
    const intersections = raycaster.intersectObject(pointsRef.current);
    if (intersections.length > 0) {
      const idx = intersections[0].index ?? -1;
      if (idx >= 0 && idx < verses.length) {
        onSelectVerse(verses[idx]);
      }
    }
  };

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: typeof window !== "undefined" ? window.devicePixelRatio : 1 },
        uSize: { value: 2.6 },
      },
      vertexShader: `
        attribute float aSize;
        attribute vec3 color;
        varying vec3 vColor;
        varying float vSize;
        uniform float uTime;
        uniform float uPixelRatio;
        uniform float uSize;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          // Breathing
          float breath = 0.85 + 0.15 * sin(uTime * 0.8 + position.x * 0.3 + position.y * 0.3);
          float s = aSize * uSize * breath * uPixelRatio;
          gl_PointSize = s * (180.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
          vSize = s;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        void main() {
          vec2 uv = gl_PointCoord * 2.0 - 1.0;
          float d = length(uv);
          if (d > 1.0) discard;
          // soft radial glow
          float alpha = smoothstep(1.0, 0.2, d);
          float core  = smoothstep(0.6, 0.0, d);
          vec3 c = vColor * (0.6 + 0.9 * core);
          gl_FragColor = vec4(c, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
    });
  }, []);

  return (
    <points
      ref={pointsRef}
      geometry={geometry}
      material={material}
      onClick={handlePointerDown as unknown as React.PointerEventHandler}
    />
  );
}
