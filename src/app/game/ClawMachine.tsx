'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import {
  Prize, PrizeType, Particle, ClawState,
  PRIZE_INFO, PRIZE_TYPES,
  GRAVITY, FRICTION, BOUNCE, PRIZE_RADIUS,
  AIR_DRAG, ANGULAR_DRAG, GROUND_FRICTION,
  VELOCITY_SLEEP_THRESHOLD, ANGULAR_SLEEP_THRESHOLD,
  PHYSICS_SUBSTEPS, COLLISION_SLOP, COLLISION_BIAS,
  LINEAR_DAMPING,
  CLAW_SPEED, DROP_ACCEL, DROP_MAX_SPEED, RETURN_SPEED,
  SWING_DAMPING, SWING_FORCE, CABLE_TOP, CLAW_CLOSE_TIME,
  CLAW_BODY_RADIUS, CLAW_PUSH_FORCE,
} from './types';

function generateId() {
  return Math.random().toString(36).slice(2, 9);
}

function generatePrizes(ml: number, mr: number, mb: number): Prize[] {
  const prizes: Prize[] = [];
  const count = 14;
  for (let i = 0; i < count; i++) {
    const type = PRIZE_TYPES[Math.floor(Math.random() * PRIZE_TYPES.length)];
    // Spawn prizes spread across the area — they fall and settle quickly
    prizes.push({
      id: generateId(),
      type,
      x: ml + 40 + Math.random() * (mr - ml - 80),
      y: mb - 100 - Math.random() * 80,
      vx: (Math.random() - 0.5) * 0.5,
      vy: Math.random() * 0.5,
      width: 32,
      height: 32,
      rotation: (Math.random() - 0.5) * Math.PI * 2,
      angularVel: (Math.random() - 0.5) * 0.03,
      grabbed: false,
      grounded: false,
      mass: 0.8 + Math.random() * 0.4,
      restitution: 0.0,
      glowPhase: Math.random() * Math.PI * 2,
    });
  }
  return prizes;
}

function spawnParticles(particles: Particle[], x: number, y: number, color: string, count: number) {
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
    const speed = 1.5 + Math.random() * 3;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 1.5,
      life: 40 + Math.random() * 30,
      maxLife: 40 + Math.random() * 30,
      size: 2 + Math.random() * 4,
      color,
      alpha: 1,
      type: Math.random() > 0.5 ? 'sparkle' : 'star',
    });
  }
}

function spawnBubbles(particles: Particle[], x: number, y: number, count: number) {
  for (let i = 0; i < count; i++) {
    particles.push({
      x: x + (Math.random() - 0.5) * 20,
      y,
      vx: (Math.random() - 0.5) * 0.5,
      vy: -(0.5 + Math.random() * 1.5),
      life: 60 + Math.random() * 40,
      maxLife: 60 + Math.random() * 40,
      size: 2 + Math.random() * 3,
      color: '#14b8a6',
      alpha: 0.6,
      type: 'bubble',
    });
  }
}

function loadState(): { score: number; collection: PrizeType[] } {
  if (typeof window === 'undefined') return { score: 0, collection: [] };
  try {
    const saved = localStorage.getItem('claw-machine-state');
    if (saved) {
      const parsed = JSON.parse(saved);
      return { score: parsed.score ?? 0, collection: parsed.collection ?? [] };
    }
  } catch { /* ignore */ }
  return { score: 0, collection: [] };
}

function saveState(score: number, collection: PrizeType[]) {
  try {
    localStorage.setItem('claw-machine-state', JSON.stringify({ score, collection }));
  } catch { /* ignore */ }
}

// Rounded rect helper
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ============================================================
// PHYSICS ENGINE
// ============================================================

/** Resolve circle-circle collision between two prizes using mass-weighted impulse */
function resolvePrizePrizeCollision(a: Prize, b: Prize) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distSq = dx * dx + dy * dy;
  const minDist = PRIZE_RADIUS * 2;
  if (distSq >= minDist * minDist || distSq === 0) return;

  const dist = Math.sqrt(distSq);
  const nx = dx / dist;
  const ny = dy / dist;

  // Positional correction (push apart) — biased to avoid sinking
  const overlap = minDist - dist;
  const correction = Math.max(overlap - COLLISION_SLOP, 0) * COLLISION_BIAS;
  const totalMass = a.mass + b.mass;
  a.x -= nx * correction * (b.mass / totalMass);
  a.y -= ny * correction * (b.mass / totalMass);
  b.x += nx * correction * (a.mass / totalMass);
  b.y += ny * correction * (a.mass / totalMass);

  // Relative velocity along collision normal
  const dvx = a.vx - b.vx;
  const dvy = a.vy - b.vy;
  const relVelNormal = dvx * nx + dvy * ny;

  // Only resolve if objects are moving toward each other
  if (relVelNormal <= 0) return;

  // Coefficient of restitution (use minimum for less bounce)
  const e = Math.min(a.restitution, b.restitution);

  // Impulse scalar
  const j = -(1 + e) * relVelNormal / (1 / a.mass + 1 / b.mass);

  // Apply impulse
  a.vx -= (j / a.mass) * nx;
  a.vy -= (j / a.mass) * ny;
  b.vx += (j / b.mass) * nx;
  b.vy += (j / b.mass) * ny;

  // Post-collision damping — absorb most energy on contact
  a.vx *= 0.5;
  a.vy *= 0.5;
  b.vx *= 0.5;
  b.vy *= 0.5;

  // Tangential friction impulse (makes objects spin on contact)
  const tangentX = -ny;
  const tangentY = nx;
  const relVelTangent = dvx * tangentX + dvy * tangentY;
  const frictionCoeff = 0.5;
  const jt = -relVelTangent * frictionCoeff / (1 / a.mass + 1 / b.mass);

  a.vx -= (jt / a.mass) * tangentX;
  a.vy -= (jt / a.mass) * tangentY;
  b.vx += (jt / b.mass) * tangentX;
  b.vy += (jt / b.mass) * tangentY;

  // Angular velocity from tangential impulse (reduced)
  a.angularVel += jt / (a.mass * PRIZE_RADIUS) * 0.05;
  b.angularVel -= jt / (b.mass * PRIZE_RADIUS) * 0.05;
}

/** Resolve collision between claw body and a prize */
function resolveClawPrizeCollision(
  clawX: number, clawY: number, clawVx: number, clawVy: number,
  prize: Prize
) {
  const clawTipY = clawY + 28;
  const dx = prize.x - clawX;
  const dy = prize.y - clawTipY;
  const distSq = dx * dx + dy * dy;
  const minDist = PRIZE_RADIUS + CLAW_BODY_RADIUS;
  if (distSq >= minDist * minDist || distSq === 0) return;

  const dist = Math.sqrt(distSq);
  const nx = dx / dist;
  const ny = dy / dist;

  // Push prize out of claw
  const overlap = minDist - dist;
  prize.x += nx * overlap;
  prize.y += ny * overlap;

  // Relative velocity (claw is kinematic — infinite mass)
  const dvx = clawVx - prize.vx;
  const dvy = clawVy - prize.vy;
  const relVelNormal = dvx * nx + dvy * ny;

  if (relVelNormal <= 0) return;

  // Gentle impulse transfer to prize (claw nudges, doesn't launch)
  const impulse = relVelNormal * CLAW_PUSH_FORCE;
  const maxImpulse = 2.0;
  const clampedImpulse = Math.min(impulse, maxImpulse);
  prize.vx += nx * clampedImpulse;
  prize.vy += ny * clampedImpulse;
  prize.angularVel += (nx * 0.5 - ny * 0.3) * clampedImpulse * 0.02;
  prize.grounded = false;
}

/** Apply wall and floor boundary constraints */
function applyBoundaries(prize: Prize, ml: number, mr: number, mb: number) {
  const floorY = mb - 12;
  const leftWall = ml + PRIZE_RADIUS + 5;
  const rightWall = mr - PRIZE_RADIUS - 5;

  // Floor
  if (prize.y > floorY - PRIZE_RADIUS) {
    prize.y = floorY - PRIZE_RADIUS;
    if (prize.vy > 0) {
      // No bouncing — just stop on the floor
      prize.vy = 0;
      prize.vx *= 0.3;
      prize.angularVel *= 0.3;
      prize.grounded = true;
      
      // If barely moving horizontally, fully stop
      if (Math.abs(prize.vx) < 1.0) {
        prize.vx = 0;
        prize.angularVel = 0;
      }
    }
  }

  // Left wall
  if (prize.x < leftWall) {
    prize.x = leftWall;
    prize.vx = 0;
    prize.angularVel *= 0.3;
  }

  // Right wall
  if (prize.x > rightWall) {
    prize.x = rightWall;
    prize.vx = 0;
    prize.angularVel *= 0.3;
  }
}

/** Run one sub-step of physics for all prizes */
function physicsStep(
  prizes: Prize[],
  ml: number, mr: number, mb: number,
  clawX: number, clawY: number, clawVx: number, clawVy: number,
  clawActive: boolean,
) {
  const substepGravity = GRAVITY / PHYSICS_SUBSTEPS;

  for (const prize of prizes) {
    if (prize.grabbed) continue;

    // Grounded objects stay at rest unless strongly disturbed
    if (prize.grounded) {
      const speed = Math.sqrt(prize.vx * prize.vx + prize.vy * prize.vy);
      if (speed > 3.0) {
        prize.grounded = false;
      } else {
        prize.vx = 0;
        prize.vy = 0;
        prize.angularVel = 0;
        continue;
      }
    }

    // Gravity
    prize.vy += substepGravity;

    // Heavy damping — applied once per frame, not per substep
    prize.vx *= 0.94;
    prize.vy *= 0.98;
    prize.angularVel *= 0.9;

    // Kill micro-velocities aggressively
    if (Math.abs(prize.vx) < 0.3) prize.vx = 0;
    if (Math.abs(prize.vy) < 0.3 && prize.vy > 0) prize.vy = 0;
    if (Math.abs(prize.angularVel) < 0.03) prize.angularVel = 0;

    // Integrate position
    prize.x += prize.vx / PHYSICS_SUBSTEPS;
    prize.y += prize.vy / PHYSICS_SUBSTEPS;

    // Rotation
    prize.rotation += prize.angularVel / PHYSICS_SUBSTEPS;
    prize.angularVel *= ANGULAR_DRAG;

    // Boundaries
    applyBoundaries(prize, ml, mr, mb);
  }

  // Prize-to-prize collisions
  for (let i = 0; i < prizes.length; i++) {
    const a = prizes[i];
    if (a.grabbed) continue;
    for (let j = i + 1; j < prizes.length; j++) {
      const b = prizes[j];
      if (b.grabbed) continue;
      resolvePrizePrizeCollision(a, b);
    }
  }

  // Claw-to-prize collisions (when claw is actively moving through prizes)
  if (clawActive) {
    for (const prize of prizes) {
      if (prize.grabbed) continue;
      resolveClawPrizeCollision(clawX, clawY, clawVx, clawVy, prize);
    }
  }
}

// ============================================================
// COMPONENT
// ============================================================

export default function ClawMachine() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<{
    claw: ClawState;
    prizes: Prize[];
    particles: Particle[];
    score: number;
    collection: PrizeType[];
    moveDirection: number;
    machineLeft: number;
    machineRight: number;
    machineTop: number;
    machineBottom: number;
    canvasWidth: number;
    canvasHeight: number;
    lastMessage: string;
    messageTimer: number;
    time: number;
    shakeTimer: number;
    shakeIntensity: number;
    lastTimestamp: number;
  } | null>(null);
  const animFrameRef = useRef<number>(0);
  const keysRef = useRef<Set<string>>(new Set());
  const [score, setScore] = useState(0);
  const [collection, setCollection] = useState<PrizeType[]>([]);
  const [message, setMessage] = useState('');
  const [canDrop, setCanDrop] = useState(true);

  const initGame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.scale(dpr, dpr);

    const pad = Math.min(30, w * 0.04);
    const machineLeft = pad + 10;
    const machineRight = w - pad - 10;
    const machineTop = 55;
    const machineBottom = h - 75;

    const saved = loadState();

    const claw: ClawState = {
      x: (machineLeft + machineRight) / 2,
      y: machineTop + 45,
      targetX: (machineLeft + machineRight) / 2,
      open: true,
      openAmount: 1,
      dropping: false,
      returning: false,
      grabbing: false,
      swingAngle: 0,
      swingSpeed: 0,
      grabbedPrize: null,
      dropY: machineBottom - 25,
      dropSpeed: 0,
      closingTimer: 0,
      prevY: machineTop + 45,
    };

    gameRef.current = {
      claw,
      prizes: generatePrizes(machineLeft, machineRight, machineBottom),
      particles: [],
      score: saved.score,
      collection: saved.collection,
      moveDirection: 0,
      machineLeft,
      machineRight,
      machineTop,
      machineBottom,
      canvasWidth: w,
      canvasHeight: h,
      lastMessage: '',
      messageTimer: 0,
      time: 0,
      shakeTimer: 0,
      shakeIntensity: 0,
      lastTimestamp: 0,
    };

    setScore(saved.score);
    setCollection(saved.collection);
  }, []);

  const showMessage = useCallback((msg: string) => {
    setMessage(msg);
    if (gameRef.current) {
      gameRef.current.lastMessage = msg;
      gameRef.current.messageTimer = 120;
    }
    setTimeout(() => setMessage(''), 2500);
  }, []);

  const dropClaw = useCallback(() => {
    const g = gameRef.current;
    if (!g || g.claw.dropping || g.claw.returning || g.claw.grabbing) return;
    g.claw.dropping = true;
    g.claw.open = true;
    g.claw.openAmount = 1;
    g.claw.dropSpeed = 0;
    g.claw.closingTimer = 0;
    g.claw.prevY = g.claw.y;
    setCanDrop(false);
  }, []);

  // --- DRAWING ---

  const drawGame = useCallback(() => {
    const canvas = canvasRef.current;
    const g = gameRef.current;
    if (!canvas || !g) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { claw, prizes, particles, machineLeft: ml, machineRight: mr, machineTop: mt, machineBottom: mb, canvasWidth: w, canvasHeight: h, time } = g;

    // Screen shake
    ctx.save();
    if (g.shakeTimer > 0) {
      const sx = (Math.random() - 0.5) * g.shakeIntensity;
      const sy = (Math.random() - 0.5) * g.shakeIntensity;
      ctx.translate(sx, sy);
    }

    // Clear
    ctx.clearRect(-10, -10, w + 20, h + 20);

    // Background gradient (deep ocean)
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    bgGrad.addColorStop(0, '#020818');
    bgGrad.addColorStop(0.5, '#041030');
    bgGrad.addColorStop(1, '#030a1a');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // Title banner
    const bannerY = 8;
    const bannerH = 38;
    const bannerGrad = ctx.createLinearGradient(0, bannerY, 0, bannerY + bannerH);
    bannerGrad.addColorStop(0, '#0c2340');
    bannerGrad.addColorStop(1, '#061428');
    ctx.fillStyle = bannerGrad;
    roundRect(ctx, ml, bannerY, mr - ml, bannerH, 10);
    ctx.fill();
    ctx.strokeStyle = '#14b8a680';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Title text with glow
    ctx.save();
    ctx.shadowColor = '#14b8a6';
    ctx.shadowBlur = 12;
    ctx.fillStyle = '#14b8a6';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('OCEAN CLAW', w / 2, bannerY + bannerH / 2);
    ctx.shadowBlur = 0;
    // Side decorations
    ctx.fillStyle = '#ff6b4a';
    ctx.font = '14px serif';
    ctx.fillText('🦞', w / 2 - 70, bannerY + bannerH / 2);
    ctx.fillText('🦞', w / 2 + 70, bannerY + bannerH / 2);
    ctx.restore();

    // Machine cabinet outer frame
    const frameInset = 4;
    ctx.save();
    ctx.shadowColor = '#14b8a6';
    ctx.shadowBlur = 20;
    const outerGrad = ctx.createLinearGradient(ml - frameInset, mt, ml - frameInset, mb);
    outerGrad.addColorStop(0, '#0f2847');
    outerGrad.addColorStop(0.5, '#143050');
    outerGrad.addColorStop(1, '#0f2040');
    ctx.fillStyle = outerGrad;
    roundRect(ctx, ml - frameInset, mt - frameInset, mr - ml + frameInset * 2, mb - mt + frameInset * 2, 16);
    ctx.fill();
    ctx.restore();

    // Machine glass area
    const glassGrad = ctx.createLinearGradient(ml, mt, ml, mb);
    glassGrad.addColorStop(0, '#060e24');
    glassGrad.addColorStop(0.3, '#081428');
    glassGrad.addColorStop(0.7, '#0a1830');
    glassGrad.addColorStop(1, '#0c1e38');
    ctx.fillStyle = glassGrad;
    roundRect(ctx, ml, mt, mr - ml, mb - mt, 12);
    ctx.fill();

    // Glass border (teal neon)
    ctx.save();
    ctx.shadowColor = '#14b8a6';
    ctx.shadowBlur = 8;
    ctx.strokeStyle = '#14b8a6';
    ctx.lineWidth = 2;
    roundRect(ctx, ml, mt, mr - ml, mb - mt, 12);
    ctx.stroke();
    ctx.restore();

    // Glass reflection (subtle)
    ctx.save();
    ctx.globalAlpha = 0.03;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(ml + 8, mt + 8, (mr - ml) * 0.25, mb - mt - 16);
    ctx.restore();

    // Underwater ambient light rays
    ctx.save();
    ctx.globalAlpha = 0.015;
    for (let i = 0; i < 4; i++) {
      const rx = ml + (mr - ml) * (0.2 + i * 0.2);
      const rayGrad = ctx.createLinearGradient(rx, mt, rx + 30, mb);
      rayGrad.addColorStop(0, '#14b8a6');
      rayGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = rayGrad;
      ctx.beginPath();
      ctx.moveTo(rx - 5, mt);
      ctx.lineTo(rx + 25, mt);
      ctx.lineTo(rx + 50 + Math.sin(time * 0.01 + i) * 10, mb);
      ctx.lineTo(rx - 10 + Math.sin(time * 0.01 + i) * 10, mb);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // Prize area floor
    const floorY = mb - 50;
    const sandGrad = ctx.createLinearGradient(ml, floorY - 30, ml, mb);
    sandGrad.addColorStop(0, 'transparent');
    sandGrad.addColorStop(0.3, '#0d1f3a');
    sandGrad.addColorStop(0.7, '#122a4a');
    sandGrad.addColorStop(1, '#152e50');
    ctx.fillStyle = sandGrad;
    ctx.fillRect(ml + 2, floorY - 30, mr - ml - 4, mb - floorY + 30 - 2);

    // Sand texture dots
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = '#3b82f6';
    for (let i = 0; i < 20; i++) {
      const sx = ml + 15 + (i * 37) % (mr - ml - 30);
      const sy = mb - 8 - (i * 13) % 35;
      ctx.beginPath();
      ctx.arc(sx, sy, 1 + (i % 2), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Animated bubbles
    ctx.save();
    for (let i = 0; i < 10; i++) {
      const period = 4000 + i * 700;
      const phase = (time * 16.67 + i * 1300) % period;
      const progress = phase / period;
      const bx = ml + 20 + ((i * 73) % (mr - ml - 40));
      const by = mb - 20 - progress * (mb - mt - 60);
      const bSize = 1.5 + (i % 3) * 0.8;
      const bAlpha = 0.12 * (1 - progress) * (0.5 + 0.5 * Math.sin(time * 0.05 + i));
      ctx.globalAlpha = bAlpha;
      ctx.strokeStyle = '#14b8a6';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(bx + Math.sin(progress * 6 + i) * 4, by, bSize, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    // --- RAIL ---
    const railY = mt + 28;
    const railH = 8;
    const railGrad = ctx.createLinearGradient(ml, railY, ml, railY + railH);
    railGrad.addColorStop(0, '#3d4f6a');
    railGrad.addColorStop(0.4, '#556b8a');
    railGrad.addColorStop(1, '#2a3a52');
    ctx.fillStyle = railGrad;
    roundRect(ctx, ml + 6, railY, mr - ml - 12, railH, 3);
    ctx.fill();
    // Rail highlight
    ctx.fillStyle = '#7090b020';
    ctx.fillRect(ml + 8, railY + 1, mr - ml - 16, 2);
    // Rail bolts
    ctx.fillStyle = '#4a6080';
    for (let bx = ml + 20; bx < mr - 20; bx += 50) {
      ctx.beginPath();
      ctx.arc(bx, railY + railH / 2, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Trolley on rail
    const trolleyW = 22;
    const trolleyH = 10;
    ctx.fillStyle = '#475569';
    roundRect(ctx, claw.x - trolleyW / 2, railY + railH - 2, trolleyW, trolleyH, 3);
    ctx.fill();
    ctx.fillStyle = '#64748b';
    ctx.fillRect(claw.x - trolleyW / 2 + 2, railY + railH - 1, trolleyW - 4, 3);
    // Trolley wheels
    ctx.fillStyle = '#334155';
    ctx.beginPath();
    ctx.arc(claw.x - 6, railY + railH - 1, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(claw.x + 6, railY + railH - 1, 3, 0, Math.PI * 2);
    ctx.fill();

    // --- CABLE ---
    const cableStartY = railY + railH + trolleyH - 2;
    const clawSwingX = claw.x + Math.sin(claw.swingAngle) * (claw.y - cableStartY) * 0.06;
    // Draw cable as slightly curved line
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(claw.x, cableStartY);
    const cableMidY = (cableStartY + claw.y) / 2;
    ctx.quadraticCurveTo(
      claw.x + Math.sin(claw.swingAngle) * (claw.y - cableStartY) * 0.03,
      cableMidY,
      clawSwingX,
      claw.y
    );
    ctx.stroke();
    // Cable highlight
    ctx.strokeStyle = '#94a3b820';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(claw.x + 1, cableStartY);
    ctx.lineTo(clawSwingX + 1, claw.y);
    ctx.stroke();

    // --- CLAW ---
    const clawX = clawSwingX;
    const clawY = claw.y;
    const openAmt = claw.openAmount;
    const armSpread = 3 + openAmt * 12;

    // Claw glow when grabbing
    if (claw.grabbing || claw.closingTimer > 0) {
      ctx.save();
      ctx.globalAlpha = 0.15 * (claw.closingTimer / CLAW_CLOSE_TIME);
      ctx.shadowColor = '#f97316';
      ctx.shadowBlur = 20;
      ctx.fillStyle = '#f97316';
      ctx.beginPath();
      ctx.arc(clawX, clawY + 15, 25, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Claw hub
    const hubGrad = ctx.createRadialGradient(clawX, clawY, 2, clawX, clawY, 10);
    hubGrad.addColorStop(0, '#fb923c');
    hubGrad.addColorStop(0.6, '#f97316');
    hubGrad.addColorStop(1, '#c2410c');
    ctx.fillStyle = hubGrad;
    ctx.beginPath();
    ctx.arc(clawX, clawY, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fdba7440';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Claw arms (3 arms with joints)
    const drawArm = (angle: number) => {
      const tipX = clawX + Math.sin(angle) * armSpread;
      const jointX = clawX + Math.sin(angle) * (armSpread * 0.5);
      const tipY = clawY + 26;
      const jointY = clawY + 14;

      // Arm segments
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(clawX, clawY + 5);
      ctx.lineTo(jointX, jointY);
      ctx.stroke();

      ctx.strokeStyle = '#78909c';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(jointX, jointY);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();

      // Joint circle
      ctx.fillStyle = '#64748b';
      ctx.beginPath();
      ctx.arc(jointX, jointY, 2.5, 0, Math.PI * 2);
      ctx.fill();

      // Tip (finger)
      ctx.fillStyle = '#cbd5e1';
      ctx.beginPath();
      ctx.arc(tipX, tipY, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#94a3b850';
      ctx.lineWidth = 1;
      ctx.stroke();
    };

    const armAngleLeft = -0.4 - openAmt * 0.35;
    const armAngleRight = 0.4 + openAmt * 0.35;
    drawArm(armAngleLeft);
    drawArm(armAngleRight);
    drawArm(0); // center arm

    // --- PRIZES ---
    ctx.font = '28px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const prize of prizes) {
      if (prize.grabbed) continue;
      ctx.save();
      ctx.translate(prize.x, prize.y);
      ctx.rotate(prize.rotation);

      // Glow effect
      const glowAlpha = 0.08 + 0.04 * Math.sin(time * 0.03 + prize.glowPhase);
      ctx.shadowColor = PRIZE_INFO[prize.type].color;
      ctx.shadowBlur = 10;
      ctx.globalAlpha = glowAlpha;
      ctx.fillStyle = PRIZE_INFO[prize.type].color;
      ctx.beginPath();
      ctx.arc(0, 0, PRIZE_RADIUS + 4, 0, Math.PI * 2);
      ctx.fill();

      // Prize emoji
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 6;
      ctx.fillText(PRIZE_INFO[prize.type].emoji, 0, 0);
      ctx.restore();
    }

    // Grabbed prize follows claw
    if (claw.grabbedPrize) {
      ctx.save();
      ctx.translate(clawX, clawY + 32);
      ctx.shadowColor = PRIZE_INFO[claw.grabbedPrize.type].color;
      ctx.shadowBlur = 12;
      ctx.fillText(PRIZE_INFO[claw.grabbedPrize.type].emoji, 0, 0);
      ctx.restore();
    }

    // --- PARTICLES ---
    for (const p of particles) {
      ctx.save();
      ctx.globalAlpha = p.alpha * (p.life / p.maxLife);
      if (p.type === 'bubble') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.stroke();
        // bubble highlight
        ctx.globalAlpha *= 0.3;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(p.x - p.size * 0.3, p.y - p.size * 0.3, p.size * 0.3, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === 'star') {
        ctx.fillStyle = p.color;
        const s = p.size * (p.life / p.maxLife);
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
          const a = (Math.PI * 2 * i) / 5 - Math.PI / 2;
          const r1 = s;
          const r2 = s * 0.4;
          ctx.lineTo(p.x + Math.cos(a) * r1, p.y + Math.sin(a) * r1);
          const a2 = a + Math.PI / 5;
          ctx.lineTo(p.x + Math.cos(a2) * r2, p.y + Math.sin(a2) * r2);
        }
        ctx.closePath();
        ctx.fill();
      } else {
        // sparkle
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (p.life / p.maxLife), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // --- CHUTE ---
    const chuteX = mr - 32;
    const chuteTopY = mt + 30;
    const chuteW = 28;
    const chuteH = 45;
    const chuteGrad = ctx.createLinearGradient(chuteX - chuteW / 2, chuteTopY, chuteX - chuteW / 2, chuteTopY + chuteH);
    chuteGrad.addColorStop(0, '#1a2744');
    chuteGrad.addColorStop(1, '#0f1d35');
    ctx.fillStyle = chuteGrad;
    roundRect(ctx, chuteX - chuteW / 2, chuteTopY, chuteW, chuteH, 6);
    ctx.fill();
    ctx.save();
    ctx.shadowColor = '#f97316';
    ctx.shadowBlur = 6;
    ctx.strokeStyle = '#f9731690';
    ctx.lineWidth = 1.5;
    roundRect(ctx, chuteX - chuteW / 2, chuteTopY, chuteW, chuteH, 6);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#f97316';
    ctx.font = 'bold 7px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('PRIZE', chuteX, chuteTopY + 16);
    ctx.fillStyle = '#f9731680';
    ctx.font = '12px sans-serif';
    ctx.fillText('▼', chuteX, chuteTopY + 30);

    // --- BOTTOM BAR ---
    const barY = h - 65;
    const barGrad = ctx.createLinearGradient(0, barY, 0, h);
    barGrad.addColorStop(0, '#06101e');
    barGrad.addColorStop(0.15, '#0a1628');
    barGrad.addColorStop(1, '#050d1a');
    ctx.fillStyle = barGrad;
    ctx.fillRect(0, barY, w, h - barY);

    // Bar top border with glow
    ctx.save();
    ctx.shadowColor = '#14b8a6';
    ctx.shadowBlur = 4;
    ctx.strokeStyle = '#14b8a650';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, barY);
    ctx.lineTo(w, barY);
    ctx.stroke();
    ctx.restore();

    // Score display
    ctx.save();
    ctx.shadowColor = '#f97316';
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#f97316';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${g.score}`, 18, barY + 25);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px sans-serif';
    ctx.fillText('SCORE', 18, barY + 42);
    ctx.restore();

    // Prize count display
    ctx.save();
    ctx.shadowColor = '#14b8a6';
    ctx.shadowBlur = 6;
    ctx.fillStyle = '#14b8a6';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${g.collection.length}`, w - 18, barY + 25);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('PRIZES', w - 18, barY + 42);
    ctx.restore();

    // Message
    if (g.messageTimer > 0) {
      ctx.save();
      const msgAlpha = Math.min(1, g.messageTimer / 20);
      ctx.globalAlpha = msgAlpha;
      // Message background
      ctx.fillStyle = '#f97316';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      const msgW = ctx.measureText(g.lastMessage).width + 30;
      ctx.globalAlpha = msgAlpha * 0.25;
      ctx.fillStyle = '#f97316';
      roundRect(ctx, w / 2 - msgW / 2, mt + 42, msgW, 28, 8);
      ctx.fill();
      ctx.globalAlpha = msgAlpha;
      ctx.shadowColor = '#f97316';
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#fbbf24';
      ctx.fillText(g.lastMessage, w / 2, mt + 58);
      ctx.restore();
    }

    // Instructions hint
    if (!claw.dropping && !claw.returning && !claw.grabbing) {
      ctx.save();
      ctx.globalAlpha = 0.35 + 0.1 * Math.sin(time * 0.04);
      ctx.fillStyle = '#64748b';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('ARROWS to move  |  SPACE to drop', w / 2, h - 6);
      ctx.restore();
    }

    ctx.restore(); // end shake
  }, []);

  // --- UPDATE / PHYSICS ---

  const update = useCallback((timestamp: number) => {
    const g = gameRef.current;
    if (!g) return;

    // Delta time calculation (capped to prevent spiral of death)
    if (g.lastTimestamp === 0) g.lastTimestamp = timestamp;
    const rawDt = (timestamp - g.lastTimestamp) / 16.667; // normalize to 60fps
    const dt = Math.min(rawDt, 3); // cap at 3 frames worth
    g.lastTimestamp = timestamp;

    const { claw } = g;
    const keys = keysRef.current;
    g.time++;

    // Handle keyboard input
    let dir = g.moveDirection;
    if (keys.has('ArrowLeft') || keys.has('a')) dir = -1;
    else if (keys.has('ArrowRight') || keys.has('d')) dir = 1;
    else if (g.moveDirection === 0) dir = 0;

    if (keys.has(' ') && !claw.dropping && !claw.returning && !claw.grabbing) {
      dropClaw();
      keys.delete(' ');
    }

    // Move claw horizontally (only when idle)
    if (!claw.dropping && !claw.returning && !claw.grabbing && dir !== 0) {
      claw.x += dir * CLAW_SPEED * dt;
      claw.x = Math.max(g.machineLeft + 30, Math.min(g.machineRight - 50, claw.x));
      claw.swingSpeed += dir * SWING_FORCE;
    }

    // Swing physics (pendulum)
    claw.swingAngle += claw.swingSpeed;
    claw.swingSpeed *= SWING_DAMPING;
    claw.swingSpeed -= claw.swingAngle * 0.015; // spring constant
    // Clamp swing
    claw.swingAngle = Math.max(-0.5, Math.min(0.5, claw.swingAngle));

    // Smoothly animate openAmount
    const targetOpen = claw.open ? 1 : 0;
    claw.openAmount += (targetOpen - claw.openAmount) * 0.15;

    // Track claw velocity for physics interactions
    const swingOffset = Math.sin(claw.swingAngle) * (claw.y - (g.machineTop + CABLE_TOP)) * 0.06;
    const clawCenterX = claw.x + swingOffset;
    const clawVy = claw.y - claw.prevY;
    claw.prevY = claw.y;

    // --- DROP PHASE (with acceleration) ---
    if (claw.dropping) {
      claw.dropSpeed = Math.min(claw.dropSpeed + DROP_ACCEL * dt, DROP_MAX_SPEED);
      claw.y += claw.dropSpeed * dt;

      if (claw.y >= claw.dropY) {
        claw.y = claw.dropY;
        claw.dropping = false;
        claw.closingTimer = CLAW_CLOSE_TIME;
        claw.open = false; // start closing

        // Screen shake on impact
        g.shakeTimer = 8;
        g.shakeIntensity = 3;

        // Spawn impact bubbles
        spawnBubbles(g.particles, clawCenterX, claw.y + 25, 6);

        // Impact: gently nudge nearby prizes outward from claw landing point
        for (const prize of g.prizes) {
          if (prize.grabbed) continue;
          const dx = prize.x - clawCenterX;
          const dy = prize.y - (claw.y + 28);
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < PRIZE_RADIUS * 2.5 && dist > 0) {
            const force = (1 - dist / (PRIZE_RADIUS * 2.5)) * 1.2;
            prize.vx += (dx / dist) * force;
            prize.vy += (dy / dist) * force * 0.5;
            prize.angularVel += (Math.random() - 0.5) * 0.05;
            prize.grounded = false;
          }
        }
      }
    }

    // --- CLOSING TIMER (claw grabs after fully closed) ---
    if (claw.closingTimer > 0) {
      claw.closingTimer--;
      if (claw.closingTimer === 0) {
        claw.grabbing = true;

        // Collision detection for grab
        const tipX = claw.x + swingOffset;
        const tipY = claw.y + 28;

        let closestPrize: Prize | null = null;
        let closestDist = Infinity;
        const grabRadius = 30;

        for (const prize of g.prizes) {
          if (prize.grabbed) continue;
          const dx = prize.x - tipX;
          const dy = prize.y - tipY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < grabRadius && dist < closestDist) {
            closestDist = dist;
            closestPrize = prize;
          }
        }

        if (closestPrize) {
          // Grab succeeds!
          closestPrize.grabbed = true;
          claw.grabbedPrize = closestPrize;

          // Particles on grab
          spawnParticles(
            g.particles,
            closestPrize.x,
            closestPrize.y,
            PRIZE_INFO[closestPrize.type].color,
            16
          );
        }

        claw.returning = true;
        claw.dropSpeed = 0;
      }
    }

    // --- RETURN PHASE ---
    if (claw.returning) {
      claw.y -= RETURN_SPEED * dt;

      if (claw.y <= g.machineTop + 45) {
        claw.y = g.machineTop + 45;

        if (claw.grabbedPrize) {
          // Move toward chute
          const chuteX = g.machineRight - 32;
          if (Math.abs(claw.x - chuteX) > 4) {
            claw.x += (chuteX > claw.x ? 1 : -1) * CLAW_SPEED * dt;
            // Keep returning (don't finish yet)
          } else {
            // Prize collected!
            const prize = claw.grabbedPrize;
            const points = PRIZE_INFO[prize.type].points;
            g.score += points;
            g.collection.push(prize.type);
            setScore(g.score);
            setCollection([...g.collection]);
            saveState(g.score, g.collection);
            showMessage(`+${points} ${PRIZE_INFO[prize.type].emoji} ${PRIZE_INFO[prize.type].label}!`);

            // Big particle burst
            spawnParticles(g.particles, claw.x, claw.y + 30, PRIZE_INFO[prize.type].color, 24);
            spawnParticles(g.particles, claw.x, claw.y + 30, '#fbbf24', 12);

            // Shake
            g.shakeTimer = 6;
            g.shakeIntensity = 2;

            claw.grabbedPrize = null;
            finishReturn(g, claw);
          }
        } else {
          showMessage('Nothing grabbed... try again!');
          finishReturn(g, claw);
        }
      }
    }

    // --- PHYSICS ENGINE (sub-stepped) ---
    const clawIsActive = claw.dropping || claw.returning;
    for (let step = 0; step < PHYSICS_SUBSTEPS; step++) {
      physicsStep(
        g.prizes,
        g.machineLeft, g.machineRight, g.machineBottom,
        clawCenterX, claw.y, 0, clawVy,
        clawIsActive,
      );
    }

    // --- PARTICLES UPDATE ---
    for (let i = g.particles.length - 1; i >= 0; i--) {
      const p = g.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life--;
      if (p.type === 'bubble') {
        p.vx += (Math.random() - 0.5) * 0.1;
        p.vy *= 0.99;
      } else {
        p.vy += 0.02; // tiny gravity on sparkles
      }
      if (p.life <= 0) {
        g.particles.splice(i, 1);
      }
    }

    // Shake decay
    if (g.shakeTimer > 0) {
      g.shakeTimer--;
      g.shakeIntensity *= 0.85;
    }

    // Decrement message timer
    if (g.messageTimer > 0) g.messageTimer--;

    // Replenish prizes if low
    const remaining = g.prizes.filter(p => !p.grabbed).length;
    if (remaining < 5) {
      const newPrizes = generatePrizes(g.machineLeft, g.machineRight, g.machineBottom);
      // Keep existing non-grabbed prizes and add new ones
      g.prizes = g.prizes.filter(p => !p.grabbed).concat(newPrizes);
    }

    drawGame();
    animFrameRef.current = requestAnimationFrame(update);
  }, [drawGame, dropClaw, showMessage]);

  function finishReturn(g: NonNullable<typeof gameRef.current>, claw: ClawState) {
    claw.returning = false;
    claw.grabbing = false;
    claw.open = true;
    claw.closingTimer = 0;
    setCanDrop(true);
    // Move back to center
    claw.x = (g.machineLeft + g.machineRight) / 2;
  }

  // --- EFFECTS ---

  useEffect(() => {
    initGame();
    animFrameRef.current = requestAnimationFrame(update);

    const handleResize = () => initGame();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (['ArrowLeft', 'ArrowRight', ' ', 'a', 'd'].includes(e.key)) {
        e.preventDefault();
        keysRef.current.add(e.key);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.key);
      if (gameRef.current) {
        if (!keysRef.current.has('ArrowLeft') && !keysRef.current.has('ArrowRight') &&
            !keysRef.current.has('a') && !keysRef.current.has('d')) {
          gameRef.current.moveDirection = 0;
        }
      }
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [initGame, update]);

  const handleMoveStart = (dir: number) => {
    if (gameRef.current) gameRef.current.moveDirection = dir;
  };

  const handleMoveEnd = () => {
    if (gameRef.current) gameRef.current.moveDirection = 0;
  };

  const collectionCounts = collection.reduce((acc, type) => {
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="flex flex-col lg:flex-row items-center justify-center min-h-screen gap-4 p-2 sm:p-4 select-none">
      {/* Game area */}
      <div className="flex flex-col items-center gap-3 w-full max-w-[420px]">
        <canvas
          ref={canvasRef}
          className="w-full rounded-2xl border border-teal-400/20 shadow-[0_0_60px_rgba(20,184,166,0.12),0_0_120px_rgba(20,184,166,0.06)]"
          style={{ aspectRatio: '3/4', maxHeight: '70vh' }}
        />

        {/* Mobile controls */}
        <div className="flex gap-3 w-full max-w-[340px]">
          <button
            className="flex-1 h-14 rounded-xl bg-gradient-to-b from-[#1a2d4a] to-[#142338] border border-teal-500/40 text-teal-400 text-2xl font-bold active:bg-teal-500/20 active:scale-95 transition-all touch-none shadow-[0_2px_12px_rgba(20,184,166,0.1)]"
            onPointerDown={() => handleMoveStart(-1)}
            onPointerUp={handleMoveEnd}
            onPointerLeave={handleMoveEnd}
            aria-label="Move left"
          >
            ◀
          </button>
          <button
            className="flex-[2] h-14 rounded-xl bg-gradient-to-b from-[#3a2210] to-[#2a1808] border border-orange-500/50 text-orange-400 text-lg font-bold active:bg-orange-500/20 active:scale-95 transition-all disabled:opacity-30 disabled:scale-100 touch-none shadow-[0_2px_12px_rgba(249,115,22,0.15)]"
            onPointerDown={dropClaw}
            disabled={!canDrop}
            aria-label="Drop claw"
          >
            🎯 DROP
          </button>
          <button
            className="flex-1 h-14 rounded-xl bg-gradient-to-b from-[#1a2d4a] to-[#142338] border border-teal-500/40 text-teal-400 text-2xl font-bold active:bg-teal-500/20 active:scale-95 transition-all touch-none shadow-[0_2px_12px_rgba(20,184,166,0.1)]"
            onPointerDown={() => handleMoveStart(1)}
            onPointerUp={handleMoveEnd}
            onPointerLeave={handleMoveEnd}
            aria-label="Move right"
          >
            ▶
          </button>
        </div>
      </div>

      {/* Side panel */}
      <div className="w-full max-w-[420px] lg:max-w-[240px] flex flex-col gap-3">
        {/* Score card */}
        <div className="rounded-xl bg-gradient-to-br from-[#1a2d4a]/90 to-[#0f1d35]/90 border border-teal-500/15 p-4 shadow-[0_4px_20px_rgba(0,0,0,0.3)]">
          <h2 className="text-teal-400/80 font-bold text-xs uppercase tracking-[0.2em] mb-1">Score</h2>
          <p className="text-3xl font-bold text-orange-400 drop-shadow-[0_0_8px_rgba(249,115,22,0.3)]">{score}</p>
        </div>

        {/* Message */}
        {message && (
          <div className="rounded-xl bg-orange-500/10 border border-orange-500/25 p-3 text-center text-orange-300 text-sm font-medium animate-pulse shadow-[0_0_20px_rgba(249,115,22,0.1)]">
            {message}
          </div>
        )}

        {/* Prize collection */}
        <div className="rounded-xl bg-gradient-to-br from-[#1a2d4a]/90 to-[#0f1d35]/90 border border-teal-500/15 p-4 shadow-[0_4px_20px_rgba(0,0,0,0.3)]">
          <h2 className="text-teal-400/80 font-bold text-xs uppercase tracking-[0.2em] mb-3">Prize Collection</h2>
          {collection.length === 0 ? (
            <p className="text-slate-500 text-sm italic">No prizes yet — drop the claw!</p>
          ) : (
            <div className="flex flex-col gap-2">
              {Object.entries(collectionCounts).map(([type, count]) => (
                <div key={type} className="flex items-center gap-2 text-sm group">
                  <span className="text-xl drop-shadow-[0_0_4px_rgba(255,255,255,0.2)]">{PRIZE_INFO[type as PrizeType].emoji}</span>
                  <span className="text-slate-300">{PRIZE_INFO[type as PrizeType].label}</span>
                  <span className="ml-auto text-teal-400 font-mono text-xs bg-teal-500/10 px-2 py-0.5 rounded-full">x{count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Reset */}
        <button
          className="rounded-lg bg-[#1a2d4a]/30 border border-slate-700/30 px-3 py-2 text-slate-600 text-xs hover:text-slate-400 hover:border-slate-500/40 transition-colors"
          onClick={() => {
            if (confirm('Reset all scores and prizes?')) {
              localStorage.removeItem('claw-machine-state');
              if (gameRef.current) {
                gameRef.current.score = 0;
                gameRef.current.collection = [];
              }
              setScore(0);
              setCollection([]);
            }
          }}
        >
          Reset Progress
        </button>
      </div>
    </div>
  );
}
