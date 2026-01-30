export interface Prize {
  id: string;
  type: PrizeType;
  x: number;
  y: number;
  vx: number;
  vy: number;
  width: number;
  height: number;
  rotation: number;
  angularVel: number;
  grabbed: boolean;
  grounded: boolean;
  mass: number;
  glowPhase: number;
}

export type PrizeType = 'lobster' | 'treasure' | 'duck' | 'starfish' | 'pearl';

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  alpha: number;
  type: 'sparkle' | 'bubble' | 'star';
}

export interface ClawState {
  x: number;
  y: number;
  targetX: number;
  open: boolean;
  openAmount: number;
  dropping: boolean;
  returning: boolean;
  grabbing: boolean;
  swingAngle: number;
  swingSpeed: number;
  grabbedPrize: Prize | null;
  dropY: number;
  dropSpeed: number;
  closingTimer: number;
}

export interface GameState {
  claw: ClawState;
  prizes: Prize[];
  particles: Particle[];
  score: number;
  collection: PrizeType[];
  machineTop: number;
  machineBottom: number;
  machineLeft: number;
  machineRight: number;
  moveDirection: number;
  time: number;
}

export const PRIZE_INFO: Record<PrizeType, { emoji: string; label: string; points: number; color: string }> = {
  lobster: { emoji: '🦞', label: 'Lobster', points: 50, color: '#ff6b6b' },
  treasure: { emoji: '🧰', label: 'Treasure', points: 40, color: '#ffd93d' },
  duck: { emoji: '🦆', label: 'Duck', points: 20, color: '#6bcb77' },
  starfish: { emoji: '⭐', label: 'Starfish', points: 30, color: '#ff9a3c' },
  pearl: { emoji: '🫧', label: 'Pearl', points: 60, color: '#a78bfa' },
};

export const PRIZE_TYPES: PrizeType[] = ['lobster', 'treasure', 'duck', 'starfish', 'pearl'];

// Physics constants
export const GRAVITY = 0.35;
export const FRICTION = 0.85;
export const BOUNCE = 0.4;
export const PRIZE_RADIUS = 16;
export const CLAW_SPEED = 3.5;
export const DROP_ACCEL = 0.25;
export const DROP_MAX_SPEED = 6;
export const RETURN_SPEED = 2.5;
export const SWING_DAMPING = 0.97;
export const SWING_FORCE = 0.025;
export const CABLE_TOP = 30;
export const CLAW_CLOSE_TIME = 18;
