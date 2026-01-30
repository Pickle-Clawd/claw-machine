export interface Prize {
  id: string;
  type: PrizeType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  grabbed: boolean;
}

export type PrizeType = 'lobster' | 'treasure' | 'duck' | 'starfish' | 'pearl';

export interface ClawState {
  x: number;
  y: number;
  targetX: number;
  open: boolean;
  dropping: boolean;
  returning: boolean;
  grabbing: boolean;
  swingAngle: number;
  swingSpeed: number;
  grabbedPrize: Prize | null;
  dropY: number;
}

export interface GameState {
  claw: ClawState;
  prizes: Prize[];
  score: number;
  collection: PrizeType[];
  machineTop: number;
  machineBottom: number;
  machineLeft: number;
  machineRight: number;
  moveDirection: number; // -1 left, 0 none, 1 right
}

export const PRIZE_INFO: Record<PrizeType, { emoji: string; label: string; points: number }> = {
  lobster: { emoji: '🦞', label: 'Lobster Plushie', points: 50 },
  treasure: { emoji: '🧰', label: 'Treasure Chest', points: 40 },
  duck: { emoji: '🦆', label: 'Rubber Duck', points: 20 },
  starfish: { emoji: '⭐', label: 'Starfish', points: 30 },
  pearl: { emoji: '🫧', label: 'Pearl', points: 60 },
};

export const PRIZE_TYPES: PrizeType[] = ['lobster', 'treasure', 'duck', 'starfish', 'pearl'];
