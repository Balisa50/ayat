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

export function Galaxy({ verses, matchedIds, pulseIds, onSelectVerse }: GalaxyProps) {
  return (
    <div className="fixed inset-0" style={{ zIndex: 0 }}>
      <Canvas
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
  onSelectVerse,
}: {
  verses: Verse[];
  matchedIds: Set<number>;
  pulseIds?: Set<number>;
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

    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(cols.slice(), 3));
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
  // Two-pass animation: phase 0→1 = shoot outward past center, phase 1→2 = return to settle
  type ShootingState = {
    indices: number[];
    originXYZ: Float32Array;        // galaxy starting positions
    launchXYZ: Float32Array;        // where each star launches FROM (may override origin for multi)
    overshootXYZ: Float32Array;     // far-wall bounce target
    settleXYZ: Float32Array;        // final resting position (near camera center)
    startTime: number;
    bounced: boolean[];             // flash flag per star
  };
  const shootRef = useRef<ShootingState | null>(null);
  const pulseRef = useRef<Set<number> | undefined>(pulseIds);
  useEffect(() => { pulseRef.current = pulseIds; }, [pulseIds]);

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

    shootRef.current = {
      indices,
      originXYZ: origin,
      launchXYZ: launch,
      overshootXYZ: overshoot,
      settleXYZ: settle,
      startTime: performance.now() / 1000,
      bounced: new Array(n).fill(false),
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
        arr[i * 3 + 0] = Math.min(1, r * 1.55 + 0.25);
        arr[i * 3 + 1] = Math.min(1, g * 1.55 + 0.25);
        arr[i * 3 + 2] = Math.min(1, b * 1.55 + 0.25);
      } else {
        arr[i * 3 + 0] = r * 0.04;
        arr[i * 3 + 1] = g * 0.04;
        arr[i * 3 + 2] = b * 0.04;
      }
    }
    colorAttr.needsUpdate = true;
  }, [matchedIds, pulseIds, verses, geometry, baseColors]);

  // Reset positions and velocities when pulse ends
  useEffect(() => {
    if (pulseIds && pulseIds.size > 0) return;
    const posAttr = geometry.getAttribute("position") as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;
    for (let i = 0; i < basePositions.length; i++) arr[i] = basePositions[i];
    posAttr.needsUpdate = true;
    // Also zero velocities
    velX.current.fill(0);
    velY.current.fill(0);
    velZ.current.fill(0);
  }, [pulseIds, geometry, basePositions]);

  const material = useMemo(
    () =>
      new THREE.PointsMaterial({
        size: 0.32,
        vertexColors: true,
        map: sprite,
        alphaMap: sprite,
        transparent: true,
        depthWrite: false,
        opacity: 0.9,
        blending: THREE.NormalBlending,
        sizeAttenuation: true,
      }),
    [sprite],
  );

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

    // ── Physics simulation (skip while shooting stars are in flight) ────────
    if (!hasPulse) {
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

    // ── Shooting star two-pass animation ────────────────────────────────────
    // Phase 0→1: launch → overshoot (first pass through center)
    // Phase 1→2: overshoot → settle (return and land)
    const PASS_SECS  = 1.4;   // seconds per pass
    const TOTAL_SECS = PASS_SECS * 2;
    const nowSec  = performance.now() / 1000;
    const elapsed = nowSec - shoot.startTime;
    const totalPhase = Math.min(2, elapsed / PASS_SECS);
    const solo = shoot.indices.length === 1;

    const allSettled = totalPhase >= 2;
    // Detect crossing flash window (2-star pass-1 midpoint)
    const inFlash = shoot.indices.length === 2 && totalPhase > 0.42 && totalPhase < 0.68;

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

      let nx: number, ny: number, nz: number;

      if (totalPhase <= 1) {
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

      // Brightness: blazing hot during travel, breathing gold once settled
      const phaseK = k * 0.9;
      let bright: number;
      if (inFlash) {
        // Crossing flash: white-hot burst
        bright = 2.2 + 0.6 * Math.abs(Math.sin(t * 40 + phaseK));
        colorArr[i * 3]     = 1.0;
        colorArr[i * 3 + 1] = 1.0;
        colorArr[i * 3 + 2] = Math.min(1, 0.85 + 0.15 * Math.abs(Math.sin(t * 40)));
        if (!shoot.bounced[k]) shoot.bounced[k] = true;
      } else if (allSettled) {
        // Settled: deep breathing gold
        bright = 0.72 + 0.50 * Math.sin(t * 3.2 + phaseK);
        if (solo) bright *= 1.35;
        colorArr[i * 3]     = Math.min(1, 1.0 * bright);
        colorArr[i * 3 + 1] = Math.min(1, 0.84 * bright);
        colorArr[i * 3 + 2] = Math.min(1, 0.36 * bright);
      } else {
        // In flight: blazing gold-white
        bright = 1.9 + 0.3 * Math.sin(t * 16 + phaseK);
        colorArr[i * 3]     = Math.min(1, 1.0 * bright);
        colorArr[i * 3 + 1] = Math.min(1, 0.88 * bright);
        colorArr[i * 3 + 2] = Math.min(1, 0.45 * bright);
      }
    }
    posAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;

    // Star size — dramatically larger during the detection animation
    // Background stars are 4% brightness so only the shooting stars pop.
    if (inFlash) {
      // Collision burst: spike to maximum
      material.size = 4.2 + Math.sin(t * 35) * 0.9;
    } else if (allSettled) {
      material.size = solo
        ? 2.8 + Math.sin(t * 3.0) * 0.55
        : 2.2 + Math.sin(t * 2.8) * 0.40;
    } else {
      // In flight: large and pulsing
      material.size = solo
        ? 3.2 + Math.sin(t * 10) * 0.45
        : 2.8 + Math.sin(t * 12) * 0.40;
    }
  });

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
      console.warn("[AYAT] WebGL context lost");
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
