"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { Verse } from "@/lib/types";

const GALAXY_SCALE = 38;

const MECCAN_COLOR = new THREE.Color("#7a93e0");
const MECCAN_COLOR_2 = new THREE.Color("#a482e8");
const MEDINAN_COLOR = new THREE.Color("#e6a667");
const MEDINAN_COLOR_2 = new THREE.Color("#cf7c4f");

interface GalaxyProps {
  verses: Verse[];
  matchedIds: Set<number>;
  pulseIds?: Set<number>;
  pulseScores?: Map<number, number>; // verse id → confidence 0-1 (highest = largest star)
  onSelectVerse: (v: Verse) => void;
}

function makeSpriteTexture(): THREE.Texture {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, "rgba(255,255,255,0.85)");
  g.addColorStop(0.25, "rgba(255,255,255,0.45)");
  g.addColorStop(0.6, "rgba(255,255,255,0.12)");
  g.addColorStop(1.0, "rgba(255,255,255,0.0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

export function Galaxy({ verses, matchedIds, pulseIds, pulseScores, onSelectVerse }: GalaxyProps) {
  return (
    <div className="fixed inset-0" style={{ zIndex: 0 }}>
      <Canvas
        aria-label="Interactive Quran star field — 6,236 verses as stars. Tap any star to read the verse."
        role="img"
        camera={{ position: [0, 6, 72], fov: 55, near: 0.1, far: 600 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          gl.setClearColor(new THREE.Color("#05060e"), 1);
        }}
      >
        <ambientLight intensity={0.4} />
        <ParticleField
          verses={verses}
          matchedIds={matchedIds}
          pulseIds={pulseIds}
          pulseScores={pulseScores}
          onSelectVerse={onSelectVerse}
        />
        <OrbitControls
          enablePan={false}
          enableZoom
          minDistance={22}
          maxDistance={160}
          zoomSpeed={0.6}
          rotateSpeed={0.35}
          autoRotate={matchedIds.size === 0 && !pulseIds?.size}
          autoRotateSpeed={0.12}
        />
      </Canvas>
    </div>
  );
}

// ─── Easing ──────────────────────────────────────────────────────────────────
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ─── Physics constants (d3-force style) ────────────────────────────────────
const SPRING_STRENGTH = 0.018;   // spring back toward base position
const VELOCITY_DECAY  = 0.88;    // damping per frame
const CENTER_GRAVITY  = 0.003;   // weak pull toward world center
const REPULSION_STR   = 0.06;    // neighbor repulsion strength
const MIN_NEIGHBOR_DIST = 1.2;   // minimum allowed star-to-star distance
const BOUNDARY_DIST   = GALAXY_SCALE * 1.35; // soft boundary radius
const BOUNDARY_STR    = 0.04;    // boundary repulsion strength

function ParticleField({
  verses,
  matchedIds,
  pulseIds,
  pulseScores,
  onSelectVerse,
}: {
  verses: Verse[];
  matchedIds: Set<number>;
  pulseIds?: Set<number>;
  pulseScores?: Map<number, number>;
  onSelectVerse: (v: Verse) => void;
}) {
  const pointsRef = useRef<THREE.Points>(null!);
  const { camera, raycaster, pointer, gl } = useThree();
  const sprite = useMemo(() => makeSpriteTexture(), []);

  const spread = (v: number, gamma = 0.55) => {
    const sign = Math.sign(v) || 1;
    return sign * Math.pow(Math.abs(v), gamma);
  };

  const { geometry, baseColors, basePositions } = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(verses.length * 3);
    const cols = new Float32Array(verses.length * 3);

    for (let i = 0; i < verses.length; i++) {
      const v = verses[i];
      const x = spread(v.x) * GALAXY_SCALE;
      const y = spread(v.y) * GALAXY_SCALE;
      const z = spread(v.z) * GALAXY_SCALE;

      const j = (seed: number) => {
        const s = Math.sin((v.id + seed) * 12.9898) * 43758.5453;
        return (s - Math.floor(s) - 0.5) * 0.6;
      };

      positions[i * 3 + 0] = x + j(1);
      positions[i * 3 + 1] = y + j(2);
      positions[i * 3 + 2] = z + j(3);

      const t = (Math.abs(Math.sin((v.cluster + 1) * 1.13)) + 1) * 0.5;
      const c =
        v.revelationType === "Meccan"
          ? MECCAN_COLOR.clone().lerp(MECCAN_COLOR_2, t)
          : MEDINAN_COLOR.clone().lerp(MEDINAN_COLOR_2, t);
      cols[i * 3 + 0] = c.r;
      cols[i * 3 + 1] = c.g;
      cols[i * 3 + 2] = c.b;
    }

    const aSizes = new Float32Array(verses.length).fill(1.0);
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(cols.slice(), 3));
    const aSizeAttr = new THREE.BufferAttribute(aSizes, 1);
    aSizeAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aSize", aSizeAttr);
    return { geometry: geo, baseColors: cols, basePositions: positions.slice() };
  }, [verses]);

  // ── Physics state ─────────────────────────────────────────────────────────
  const velX = useRef(new Float32Array(verses.length));
  const velY = useRef(new Float32Array(verses.length));
  const velZ = useRef(new Float32Array(verses.length));

  // ID → index map for neighbor lookups
  const idToIndex = useMemo(() => {
    const m = new Map<number, number>();
    for (let i = 0; i < verses.length; i++) m.set(verses[i].id, i);
    return m;
  }, [verses]);

  // Stable camera ref so pointer handlers always read the latest orientation
  const cameraRef = useRef(camera);
  useEffect(() => { cameraRef.current = camera; }, [camera]);

  // Swipe impulse tracking
  const swipeRef = useRef({
    prevX: 0, prevY: 0,
    vx: 0, vy: 0,
    active: false,
  });

  // ── Shooting-star state ───────────────────────────────────────────────────
  // Animation phases:
  //   Phase 0→1 (PASS_SECS):  launch → overshoot
  //   Phase 1→2 (PASS_SECS):  overshoot → settle
  //   Phase 2+  (SETTLE_PAUSE): breathe at settleXYZ
  //   Return phase (RETURN_SECS): drift back from settleXYZ → originXYZ
  //   After return: stars at origin, still gold, slightly larger (aSize=1.5)
  type ShootingState = {
    indices: number[];
    rankSizes: number[];            // target aSize per star (k → rankSizes[k])
    originXYZ: Float32Array;        // galaxy starting positions
    launchXYZ: Float32Array;        // where each star launches FROM
    overshootXYZ: Float32Array;     // far-wall bounce target
    settleXYZ: Float32Array;        // final resting position (near camera center)
    startTime: number;
    bounced: boolean[];             // flash flag per star
    returnStartTime: number;        // timestamp when return-to-galaxy begins; -1 until then
  };
  const SETTLE_PAUSE = 2.0;         // seconds to stay at settleXYZ before drifting back
  const RETURN_SECS  = 3.0;         // seconds for return-to-galaxy drift
  const shootRef = useRef<ShootingState | null>(null);
  const pulseRef = useRef<Set<number> | undefined>(pulseIds);
  useEffect(() => { pulseRef.current = pulseIds; }, [pulseIds]);
  const pulseScoresRef = useRef<Map<number, number> | undefined>(pulseScores);
  useEffect(() => { pulseScoresRef.current = pulseScores; }, [pulseScores]);

  useEffect(() => {
    if (!pulseIds || pulseIds.size === 0) {
      shootRef.current = null;
      return;
    }

    const indices: number[] = [];
    for (let i = 0; i < verses.length; i++) {
      if (pulseIds.has(verses[i].id)) indices.push(i);
    }
    if (indices.length === 0) { shootRef.current = null; return; }

    const posAttr = geometry.getAttribute("position") as THREE.BufferAttribute;
    const posArr = posAttr.array as Float32Array;
    posAttr.setUsage(THREE.DynamicDrawUsage);

    const camPos = camera.position;
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);

    // All animation happens in camera view-plane at DEPTH units in front of camera.
    const DEPTH = 28;
    const clusterCenter = camPos.clone().add(forward.clone().multiplyScalar(DEPTH));
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const up    = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);

    // Edge distance: just outside the visible viewport at DEPTH units.
    // FOV 55 → half-width ≈ DEPTH * tan(27.5°) ≈ 14.6. Use 17 to be just off-screen.
    const EDGE = 17;
    // 75% overshoot creates a genuine crossing for 2-star mode.
    const OVERSHOOT = 0.75;

    const n = indices.length;
    const origin    = new Float32Array(n * 3);
    const launch    = new Float32Array(n * 3);
    const overshoot = new Float32Array(n * 3);
    const settle    = new Float32Array(n * 3);

    for (let k = 0; k < n; k++) {
      const idx = indices[k];
      origin[k * 3]     = posArr[idx * 3];
      origin[k * 3 + 1] = posArr[idx * 3 + 1];
      origin[k * 3 + 2] = posArr[idx * 3 + 2];

      // Settle: spread around cluster center in view-plane
      let sdx = 0, sdy = 0;
      if (n === 1) {
        sdx = 0; sdy = 0;
      } else if (n === 2) {
        sdx = k === 0 ? -3.5 :  3.5;
        sdy = k === 0 ?  1.0 : -1.0;
      } else {
        const angle = (k / n) * Math.PI * 2;
        sdx = Math.cos(angle) * 3.2;
        sdy = Math.sin(angle) * 3.2;
      }
      const settlePt = clusterCenter.clone()
        .add(right.clone().multiplyScalar(sdx))
        .add(up.clone().multiplyScalar(sdy));
      settle[k * 3]     = settlePt.x;
      settle[k * 3 + 1] = settlePt.y;
      settle[k * 3 + 2] = settlePt.z;

      // Launch: from just off the screen edges in view-plane
      let ldx = 0, ldy = 0;
      if (n === 1) {
        // Single: diagonal from top-right corner
        ldx =  EDGE * 0.85;
        ldy =  EDGE * 0.85;
      } else if (n === 2) {
        // Two: shoot in from opposite horizontal edges
        ldx = k === 0 ? -EDGE :  EDGE;
        ldy = k === 0 ?   2.5 : -2.5;
      } else {
        // Three: fan in from top, bottom-right, bottom-left
        const edgeAngles = [Math.PI / 2, Math.PI * 1.17, Math.PI * 1.83];
        const ea = edgeAngles[k] ?? (k / n) * Math.PI * 2;
        ldx = Math.cos(ea) * EDGE;
        ldy = Math.sin(ea) * EDGE;
      }
      const launchPt = clusterCenter.clone()
        .add(right.clone().multiplyScalar(ldx))
        .add(up.clone().multiplyScalar(ldy));
      launch[k * 3]     = launchPt.x;
      launch[k * 3 + 1] = launchPt.y;
      launch[k * 3 + 2] = launchPt.z;

      // Overshoot: continue past settle by OVERSHOOT fraction of travel distance.
      // For 2-star this pushes each star ~6 units past the center, making them
      // visually cross each other before snapping back — violent collision effect.
      const sx = settlePt.x, sy = settlePt.y, sz = settlePt.z;
      const lx = launchPt.x, ly = launchPt.y, lz = launchPt.z;
      overshoot[k * 3]     = sx + (sx - lx) * OVERSHOOT;
      overshoot[k * 3 + 1] = sy + (sy - ly) * OVERSHOOT;
      overshoot[k * 3 + 2] = sz + (sz - lz) * OVERSHOOT;
    }

    // Warp stars to their launch positions immediately
    for (let k = 0; k < n; k++) {
      const idx = indices[k];
      posArr[idx * 3]     = launch[k * 3];
      posArr[idx * 3 + 1] = launch[k * 3 + 1];
      posArr[idx * 3 + 2] = launch[k * 3 + 2];
    }
    posAttr.needsUpdate = true;

    // Pre-compute per-star target sizes based on confidence rank.
    // Higher confidence → bigger star so user reaches for the most likely first.
    const RANK_SIZES = [3.8, 2.8, 2.0, 1.6, 1.3];
    const scores = pulseScoresRef.current;
    // Sort indices by confidence descending to assign ranks
    const indexedScores = indices.map((idx) => ({
      idx,
      conf: scores?.get(verses[idx].id) ?? 0.7,
    }));
    indexedScores.sort((a, b) => b.conf - a.conf);
    // rankSizes[k] = target aSize for indices[k]
    const rankSizes: number[] = new Array(n).fill(1.2);
    indexedScores.forEach(({ idx }, rank) => {
      const k = indices.indexOf(idx);
      rankSizes[k] = RANK_SIZES[Math.min(rank, RANK_SIZES.length - 1)];
    });

    shootRef.current = {
      indices,
      rankSizes,
      originXYZ: origin,
      launchXYZ: launch,
      overshootXYZ: overshoot,
      settleXYZ: settle,
      startTime: performance.now() / 1000,
      bounced: new Array(n).fill(false),
      returnStartTime: -1,
    };
  }, [pulseIds, verses, geometry, camera]);

  // Colors: match / pulse / none
  useEffect(() => {
    const colorAttr = geometry.getAttribute("color") as THREE.BufferAttribute;
    const arr = colorAttr.array as Float32Array;
    const hasPulse = (pulseIds?.size ?? 0) > 0;
    const hasMatches = matchedIds.size > 0;
    for (let i = 0; i < verses.length; i++) {
      const v = verses[i];
      const r = baseColors[i * 3 + 0];
      const g = baseColors[i * 3 + 1];
      const b = baseColors[i * 3 + 2];
      if (hasPulse) {
        if (pulseIds!.has(v.id)) {
          arr[i * 3 + 0] = 1.0;
          arr[i * 3 + 1] = 0.84;
          arr[i * 3 + 2] = 0.36;
        } else {
          arr[i * 3 + 0] = r * 0.04;
          arr[i * 3 + 1] = g * 0.04;
          arr[i * 3 + 2] = b * 0.04;
        }
      } else if (!hasMatches) {
        arr[i * 3 + 0] = r;
        arr[i * 3 + 1] = g;
        arr[i * 3 + 2] = b;
      } else if (matchedIds.has(v.id)) {
        arr[i * 3 + 0] = Math.min(1, r * 1.65 + 0.30);
        arr[i * 3 + 1] = Math.min(1, g * 1.65 + 0.30);
        arr[i * 3 + 2] = Math.min(1, b * 1.65 + 0.30);
      } else {
        // Keep unmatched stars faintly visible so the galaxy field stays intact
        arr[i * 3 + 0] = r * 0.13;
        arr[i * 3 + 1] = g * 0.13;
        arr[i * 3 + 2] = b * 0.13;
      }
    }
    colorAttr.needsUpdate = true;
  }, [matchedIds, pulseIds, verses, geometry, baseColors]);

  // Reset positions, velocities, and aSize when pulse ends
  useEffect(() => {
    if (pulseIds && pulseIds.size > 0) return;
    const posAttr = geometry.getAttribute("position") as THREE.BufferAttribute;
    const posArr = posAttr.array as Float32Array;
    for (let i = 0; i < basePositions.length; i++) posArr[i] = basePositions[i];
    posAttr.needsUpdate = true;
    // Reset per-vertex sizes back to 1.0
    const aSizeAttr = geometry.getAttribute("aSize") as THREE.BufferAttribute;
    const aSizeArr = aSizeAttr.array as Float32Array;
    aSizeArr.fill(1.0);
    aSizeAttr.needsUpdate = true;
    // Also zero velocities
    velX.current.fill(0);
    velY.current.fill(0);
    velZ.current.fill(0);
  }, [pulseIds, geometry, basePositions]);

  const material = useMemo(() => {
    const mat = new THREE.PointsMaterial({
      size: 0.32,
      vertexColors: true,
      map: sprite,
      alphaMap: sprite,
      transparent: true,
      depthWrite: false,
      opacity: 0.9,
      blending: THREE.NormalBlending,
      sizeAttenuation: true,
    });
    // Inject per-vertex size attribute so each detective-result star
    // can be scaled independently by confidence rank.
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "attribute float aSize;\n#include <common>",
        )
        .replace(
          "gl_PointSize = size;",
          "gl_PointSize = size * aSize;",
        );
    };
    return mat;
  }, [sprite]);

  // ── Pointer / swipe tracking for impulse ─────────────────────────────────
  useEffect(() => {
    const canvas = gl.domElement;
    let lastTime = 0;

    const onDown = (e: PointerEvent) => {
      swipeRef.current.prevX = e.clientX;
      swipeRef.current.prevY = e.clientY;
      swipeRef.current.vx = 0;
      swipeRef.current.vy = 0;
      swipeRef.current.active = true;
      lastTime = performance.now();
    };

    const onMove = (e: PointerEvent) => {
      if (!swipeRef.current.active) return;
      const now = performance.now();
      const dt = Math.max(1, now - lastTime);
      swipeRef.current.vx = (e.clientX - swipeRef.current.prevX) / dt;
      swipeRef.current.vy = (e.clientY - swipeRef.current.prevY) / dt;
      swipeRef.current.prevX = e.clientX;
      swipeRef.current.prevY = e.clientY;
      lastTime = now;
    };

    const onUp = () => {
      if (!swipeRef.current.active) return;
      swipeRef.current.active = false;

      const { vx, vy } = swipeRef.current;
      const speed = Math.sqrt(vx * vx + vy * vy);
      if (speed < 0.5) return; // ignore slow drags (camera rotate)

      // Apply impulse in camera-relative space so the stars always follow
      // the swipe direction regardless of how OrbitControls has rotated the camera.
      // screen-right (+vx) → camera's right axis
      // screen-down  (+vy) → negative camera's up axis
      const cam = cameraRef.current;
      const rightVec = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
      const upVec    = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
      const impulse  = Math.min(speed * 1.8, 4.5) * 0.12;

      const vxArr = velX.current;
      const vyArr = velY.current;
      const vzArr = velZ.current;
      for (let i = 0; i < verses.length; i++) {
        vxArr[i] += (rightVec.x * vx - upVec.x * vy) * impulse;
        vyArr[i] += (rightVec.y * vx - upVec.y * vy) * impulse;
        vzArr[i] += (rightVec.z * vx - upVec.z * vy) * impulse;
      }
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
    };
  }, [gl, verses.length]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;

    const posAttr = geometry.getAttribute("position") as THREE.BufferAttribute;
    const posArr  = posAttr.array as Float32Array;
    const colorAttr = geometry.getAttribute("color") as THREE.BufferAttribute;
    const colorArr  = colorAttr.array as Float32Array;

    const vxArr = velX.current;
    const vyArr = velY.current;
    const vzArr = velZ.current;

    const hasPulse = (pulseRef.current?.size ?? 0) > 0;
    const shoot = shootRef.current;
    const aSizeAttr = geometry.getAttribute("aSize") as THREE.BufferAttribute;
    const aSizeArr  = aSizeAttr.array as Float32Array;

    // ── Physics simulation (skip while shooting stars are in flight or returning) ──
    const isReturning = shoot && shoot.returnStartTime > 0;
    if (!hasPulse && !isReturning) {
      for (let i = 0; i < verses.length; i++) {
        const px = posArr[i * 3 + 0];
        const py = posArr[i * 3 + 1];
        const pz = posArr[i * 3 + 2];
        const bx = basePositions[i * 3 + 0];
        const by = basePositions[i * 3 + 1];
        const bz = basePositions[i * 3 + 2];

        // Spring back to base position
        vxArr[i] += (bx - px) * SPRING_STRENGTH;
        vyArr[i] += (by - py) * SPRING_STRENGTH;
        vzArr[i] += (bz - pz) * SPRING_STRENGTH;

        // Weak center gravity
        vxArr[i] += -px * CENTER_GRAVITY;
        vyArr[i] += -py * CENTER_GRAVITY;
        vzArr[i] += -pz * CENTER_GRAVITY;

        // Boundary repulsion — keeps stars from escaping viewport
        const dist = Math.sqrt(px * px + py * py + pz * pz);
        if (dist > BOUNDARY_DIST) {
          const excess = dist - BOUNDARY_DIST;
          vxArr[i] -= (px / dist) * excess * BOUNDARY_STR;
          vyArr[i] -= (py / dist) * excess * BOUNDARY_STR;
          vzArr[i] -= (pz / dist) * excess * BOUNDARY_STR;
        }

        // Neighbor repulsion (uses neighbors list for O(N·k) complexity)
        const neighborIds = verses[i].neighbors;
        if (neighborIds) {
          for (const nid of neighborIds) {
            const j = idToIndex.get(nid);
            if (j === undefined || j === i) continue;
            const dx = px - posArr[j * 3 + 0];
            const dy = py - posArr[j * 3 + 1];
            const dz = pz - posArr[j * 3 + 2];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < MIN_NEIGHBOR_DIST * MIN_NEIGHBOR_DIST && d2 > 0) {
              const d = Math.sqrt(d2);
              const force = REPULSION_STR * (MIN_NEIGHBOR_DIST - d) / d;
              vxArr[i] += dx * force;
              vyArr[i] += dy * force;
              vzArr[i] += dz * force;
            }
          }
        }

        // Velocity decay
        vxArr[i] *= VELOCITY_DECAY;
        vyArr[i] *= VELOCITY_DECAY;
        vzArr[i] *= VELOCITY_DECAY;

        // Apply velocity
        posArr[i * 3 + 0] += vxArr[i];
        posArr[i * 3 + 1] += vyArr[i];
        posArr[i * 3 + 2] += vzArr[i];
      }
      posAttr.needsUpdate = true;
    }

    // ── Global material breathing (when no shoot active) ────────────────────
    if (!shoot) {
      material.size = 0.31 + Math.sin(t * 0.4) * 0.018;
      return;
    }

    // ── Shooting star animation ──────────────────────────────────────────────
    // Phase 0→1 (PASS_SECS):  launch → overshoot
    // Phase 1→2 (PASS_SECS):  overshoot → settle
    // Settled + SETTLE_PAUSE: breathing gold at settleXYZ
    // Return phase (RETURN_SECS): drift back to originXYZ, stay gold+larger in galaxy
    const PASS_SECS = 1.4;
    const nowSec  = performance.now() / 1000;
    const elapsed = nowSec - shoot.startTime;
    const totalPhase = Math.min(2, elapsed / PASS_SECS);
    const solo = shoot.indices.length === 1;

    const allSettled = totalPhase >= 2;
    const inFlash = shoot.indices.length === 2 && totalPhase > 0.42 && totalPhase < 0.68;

    // Return-to-galaxy animation is intentionally disabled.
    // Sending stars back to their originXYZ buries them inside the sphere of
    // 6,236 stars — invisible and impossible to tap. Instead, pulsed stars
    // stay at their settle positions (foreground, clearly visible) until the
    // user explicitly clears the results with X or a new search.
    const returning = false;
    const returnProgress = 0;
    for (let k = 0; k < shoot.indices.length; k++) {
      const i = shoot.indices[k];
      const lx = shoot.launchXYZ[k * 3];
      const ly = shoot.launchXYZ[k * 3 + 1];
      const lz = shoot.launchXYZ[k * 3 + 2];
      const ox = shoot.overshootXYZ[k * 3];
      const oy = shoot.overshootXYZ[k * 3 + 1];
      const oz = shoot.overshootXYZ[k * 3 + 2];
      const sx = shoot.settleXYZ[k * 3];
      const sy = shoot.settleXYZ[k * 3 + 1];
      const sz = shoot.settleXYZ[k * 3 + 2];
      const rx = shoot.originXYZ[k * 3];
      const ry = shoot.originXYZ[k * 3 + 1];
      const rz = shoot.originXYZ[k * 3 + 2];

      let nx: number, ny: number, nz: number;

      if (returning) {
        // Drift smoothly from settleXYZ back to originXYZ
        const eased = easeInOutCubic(returnProgress);
        nx = sx + (rx - sx) * eased;
        ny = sy + (ry - sy) * eased;
        nz = sz + (rz - sz) * eased;
      } else if (totalPhase <= 1) {
        // Pass 1: launch → overshoot
        const eased = easeOutCubic(totalPhase);
        nx = lx + (ox - lx) * eased;
        ny = ly + (oy - ly) * eased;
        nz = lz + (oz - lz) * eased;
      } else {
        // Pass 2: overshoot → settle
        const eased = easeInOutCubic(totalPhase - 1);
        nx = ox + (sx - ox) * eased;
        ny = oy + (sy - oy) * eased;
        nz = oz + (sz - oz) * eased;
      }

      posArr[i * 3]     = nx;
      posArr[i * 3 + 1] = ny;
      posArr[i * 3 + 2] = nz;

      // Per-vertex size: biggest star = most confident, scales down by rank
      const targetSize = shoot.rankSizes[k] ?? 1.2;
      if (allSettled) {
        // Breathe gently at full target size — star stays large and findable
        const breathe = 1 + 0.12 * Math.sin(t * 3.2 + k * 0.9);
        aSizeArr[i] = targetSize * breathe;
      } else {
        // In flight: ramp up to target size as stars approach settle
        const ramp = totalPhase <= 1 ? totalPhase : 1;
        aSizeArr[i] = 1.0 + (targetSize - 1.0) * eased_ramp(ramp);
      }

      // Brightness animation
      const phaseK = k * 0.9;
      let bright: number;
      if (inFlash) {
        bright = 2.2 + 0.6 * Math.abs(Math.sin(t * 40 + phaseK));
        colorArr[i * 3]     = 1.0;
        colorArr[i * 3 + 1] = 1.0;
        colorArr[i * 3 + 2] = Math.min(1, 0.85 + 0.15 * Math.abs(Math.sin(t * 40)));
        if (!shoot.bounced[k]) shoot.bounced[k] = true;
      } else if (allSettled) {
        // Gold breathing glow — full brightness, stays settled in foreground
        const conf = pulseScoresRef.current?.get(verses[i].id) ?? 0.7;
        const rankBoost = 0.5 + conf * 1.0;
        bright = (0.92 + 0.50 * Math.sin(t * 3.2 + phaseK)) * rankBoost;
        if (solo) bright *= 1.35;
        colorArr[i * 3]     = Math.min(1, 1.0 * bright);
        colorArr[i * 3 + 1] = Math.min(1, 0.84 * bright);
        colorArr[i * 3 + 2] = Math.min(1, 0.36 * bright);
      } else {
        // In flight: blazing gold-white
        const conf = pulseScoresRef.current?.get(verses[i].id) ?? 0.7;
        const rankBoost = 0.6 + conf * 0.8;
        bright = (1.9 + 0.3 * Math.sin(t * 16 + phaseK)) * rankBoost;
        colorArr[i * 3]     = Math.min(1, 1.0 * bright);
        colorArr[i * 3 + 1] = Math.min(1, 0.88 * bright);
        colorArr[i * 3 + 2] = Math.min(1, 0.45 * bright);
      }
    }
    posAttr.needsUpdate    = true;
    colorAttr.needsUpdate  = true;
    aSizeAttr.needsUpdate  = true;

    // Global material.size: used as baseline that aSize multiplies against.
    // Keep it at the pulsing-breathing value from the settle/return phase.
    if (inFlash) {
      material.size = 4.2 + Math.sin(t * 35) * 0.9;
    } else if (allSettled) {
      // aSize handles per-vertex scaling; breathe the baseline gently
      material.size = 0.82 + Math.sin(t * 2.8) * 0.08;
    } else {
      // In flight: slightly larger base
      material.size = solo
        ? 0.80 + Math.sin(t * 10) * 0.06
        : 0.76 + Math.sin(t * 12) * 0.05;
    }
  });

  // Helper used in the in-flight aSize ramp (not a hook — just a local function)
  function eased_ramp(x: number): number {
    return easeOutCubic(x);
  }

  const handleClick = () => {
    if (!pointsRef.current) return;
    raycaster.setFromCamera(pointer, camera);
    raycaster.params.Points = { threshold: 0.8 };
    const hits = raycaster.intersectObject(pointsRef.current);
    if (hits.length > 0) {
      const idx = hits[0].index ?? -1;
      if (idx >= 0 && idx < verses.length) {
        onSelectVerse(verses[idx]);
      }
    }
  };

  useEffect(() => {
    const canvas = gl.domElement;
    const onLost = (e: Event) => {
      e.preventDefault();
      // WebGL context lost — browser will restore it automatically
    };
    canvas.addEventListener("webglcontextlost", onLost);
    return () => canvas.removeEventListener("webglcontextlost", onLost);
  }, [gl]);

  return (
    <points
      ref={pointsRef}
      geometry={geometry}
      material={material}
      onClick={handleClick}
    />
  );
}
