'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { Prize, PrizeType, ClawState, PRIZE_INFO, PRIZE_TYPES } from './types';

const CLAW_SPEED = 3;
const DROP_SPEED = 4;
const RETURN_SPEED = 3;
const SWING_DAMPING = 0.98;
const SWING_FORCE = 0.02;
const GRAB_CHANCE = 0.65;
const CABLE_TOP = 30;

function generateId() {
  return Math.random().toString(36).slice(2, 9);
}

function generatePrizes(machineLeft: number, machineRight: number, machineBottom: number): Prize[] {
  const prizes: Prize[] = [];
  const prizeAreaTop = machineBottom - 120;
  const prizeAreaBottom = machineBottom - 20;
  const count = 12;
  for (let i = 0; i < count; i++) {
    const type = PRIZE_TYPES[Math.floor(Math.random() * PRIZE_TYPES.length)];
    prizes.push({
      id: generateId(),
      type,
      x: machineLeft + 30 + Math.random() * (machineRight - machineLeft - 60),
      y: prizeAreaTop + Math.random() * (prizeAreaBottom - prizeAreaTop),
      width: 32,
      height: 32,
      rotation: (Math.random() - 0.5) * 0.6,
      grabbed: false,
    });
  }
  return prizes;
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

export default function ClawMachine() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<{
    claw: ClawState;
    prizes: Prize[];
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

    const pad = Math.min(40, w * 0.05);
    const machineLeft = pad;
    const machineRight = w - pad;
    const machineTop = 60;
    const machineBottom = h - 80;

    const saved = loadState();

    const claw: ClawState = {
      x: (machineLeft + machineRight) / 2,
      y: machineTop + 40,
      targetX: (machineLeft + machineRight) / 2,
      open: true,
      dropping: false,
      returning: false,
      grabbing: false,
      swingAngle: 0,
      swingSpeed: 0,
      grabbedPrize: null,
      dropY: machineBottom - 30,
    };

    gameRef.current = {
      claw,
      prizes: generatePrizes(machineLeft, machineRight, machineBottom),
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
    setTimeout(() => setMessage(''), 2000);
  }, []);

  const dropClaw = useCallback(() => {
    const g = gameRef.current;
    if (!g || g.claw.dropping || g.claw.returning) return;
    g.claw.dropping = true;
    g.claw.open = true;
    setCanDrop(false);
  }, []);

  const drawGame = useCallback(() => {
    const canvas = canvasRef.current;
    const g = gameRef.current;
    if (!canvas || !g) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { claw, prizes, machineLeft, machineRight, machineTop, machineBottom, canvasWidth: w, canvasHeight: h } = g;

    // Clear
    ctx.clearRect(0, 0, w, h);

    // Machine body (glass area)
    const grad = ctx.createLinearGradient(machineLeft, machineTop, machineLeft, machineBottom);
    grad.addColorStop(0, '#0f1729');
    grad.addColorStop(1, '#0a1020');
    ctx.fillStyle = grad;
    ctx.strokeStyle = '#14b8a6';
    ctx.lineWidth = 3;
    const radius = 12;
    ctx.beginPath();
    ctx.moveTo(machineLeft + radius, machineTop);
    ctx.lineTo(machineRight - radius, machineTop);
    ctx.quadraticCurveTo(machineRight, machineTop, machineRight, machineTop + radius);
    ctx.lineTo(machineRight, machineBottom - radius);
    ctx.quadraticCurveTo(machineRight, machineBottom, machineRight - radius, machineBottom);
    ctx.lineTo(machineLeft + radius, machineBottom);
    ctx.quadraticCurveTo(machineLeft, machineBottom, machineLeft, machineBottom - radius);
    ctx.lineTo(machineLeft, machineTop + radius);
    ctx.quadraticCurveTo(machineLeft, machineTop, machineLeft + radius, machineTop);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Glass reflection
    ctx.save();
    ctx.globalAlpha = 0.04;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(machineLeft + 10, machineTop + 10, (machineRight - machineLeft) * 0.3, machineBottom - machineTop - 20);
    ctx.restore();

    // Prize area floor (sand)
    const sandGrad = ctx.createLinearGradient(machineLeft, machineBottom - 130, machineLeft, machineBottom);
    sandGrad.addColorStop(0, 'transparent');
    sandGrad.addColorStop(0.3, '#1a2744');
    sandGrad.addColorStop(1, '#1e2d4a');
    ctx.fillStyle = sandGrad;
    ctx.fillRect(machineLeft + 3, machineBottom - 130, machineRight - machineLeft - 6, 130 - 3);

    // Water/bubble effects
    ctx.save();
    ctx.globalAlpha = 0.08;
    for (let i = 0; i < 8; i++) {
      const bx = machineLeft + 20 + ((i * 73 + Date.now() * 0.01) % (machineRight - machineLeft - 40));
      const by = machineTop + 50 + ((i * 53 + Date.now() * 0.005) % (machineBottom - machineTop - 160));
      ctx.fillStyle = '#14b8a6';
      ctx.beginPath();
      ctx.arc(bx, by, 3 + (i % 3), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Rail
    ctx.fillStyle = '#334155';
    ctx.fillRect(machineLeft + 5, machineTop + 25, machineRight - machineLeft - 10, 6);
    ctx.fillStyle = '#475569';
    ctx.fillRect(machineLeft + 5, machineTop + 25, machineRight - machineLeft - 10, 2);

    // Cable
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(claw.x, machineTop + CABLE_TOP);
    ctx.lineTo(claw.x + Math.sin(claw.swingAngle) * 5, claw.y);
    ctx.stroke();

    // Claw
    const clawX = claw.x + Math.sin(claw.swingAngle) * 8;
    const clawY = claw.y;
    const openAmount = claw.open ? 12 : 3;

    // Claw body
    ctx.fillStyle = '#94a3b8';
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2;

    // Center piece
    ctx.fillStyle = '#f97316';
    ctx.beginPath();
    ctx.arc(clawX, clawY, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fb923c';
    ctx.stroke();

    // Left arm
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(clawX, clawY + 4);
    ctx.lineTo(clawX - openAmount, clawY + 22);
    ctx.lineTo(clawX - openAmount - 4, clawY + 28);
    ctx.stroke();

    // Right arm
    ctx.beginPath();
    ctx.moveTo(clawX, clawY + 4);
    ctx.lineTo(clawX + openAmount, clawY + 22);
    ctx.lineTo(clawX + openAmount + 4, clawY + 28);
    ctx.stroke();

    // Center arm
    ctx.beginPath();
    ctx.moveTo(clawX, clawY + 4);
    ctx.lineTo(clawX, clawY + 24);
    ctx.lineTo(clawX, clawY + 30);
    ctx.stroke();

    // Tips
    ctx.fillStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.arc(clawX - openAmount - 4, clawY + 28, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(clawX + openAmount + 4, clawY + 28, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(clawX, clawY + 30, 3, 0, Math.PI * 2);
    ctx.fill();

    // Prizes
    ctx.font = '28px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const prize of prizes) {
      if (prize.grabbed) continue;
      ctx.save();
      ctx.translate(prize.x, prize.y);
      ctx.rotate(prize.rotation);
      ctx.fillText(PRIZE_INFO[prize.type].emoji, 0, 0);
      ctx.restore();
    }

    // Grabbed prize follows claw
    if (claw.grabbedPrize) {
      ctx.save();
      ctx.translate(clawX, clawY + 35);
      ctx.fillText(PRIZE_INFO[claw.grabbedPrize.type].emoji, 0, 0);
      ctx.restore();
    }

    // Chute indicator
    const chuteX = machineRight - 35;
    const chuteTop = machineTop + 30;
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#f97316';
    ctx.lineWidth = 2;
    ctx.fillRect(chuteX - 15, chuteTop, 30, 50);
    ctx.strokeRect(chuteX - 15, chuteTop, 30, 50);
    ctx.fillStyle = '#f9731680';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('CHUTE', chuteX, chuteTop + 25);
    ctx.fillText('▼', chuteX, chuteTop + 40);

    // Title
    ctx.fillStyle = '#14b8a6';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🦞 OCEAN CLAW 🦞', w / 2, 30);

    // Bottom bar
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, h - 70, w, 70);
    ctx.strokeStyle = '#14b8a6';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h - 70);
    ctx.lineTo(w, h - 70);
    ctx.stroke();

    // Score on canvas
    ctx.fillStyle = '#f97316';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`Score: ${g.score}`, 15, h - 45);

    ctx.fillStyle = '#14b8a6';
    ctx.font = '14px sans-serif';
    ctx.fillText(`Prizes: ${g.collection.length}`, 15, h - 22);

    // Message
    if (g.messageTimer > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, g.messageTimer / 30);
      ctx.fillStyle = '#f97316';
      ctx.font = 'bold 18px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(g.lastMessage, w / 2, machineTop + 50);
      ctx.restore();
    }

    // Instructions hint
    if (!claw.dropping && !claw.returning) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#94a3b8';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('← → to move | SPACE to drop', w / 2, h - 10);
      ctx.restore();
    }
  }, []);

  const update = useCallback(() => {
    const g = gameRef.current;
    if (!g) return;

    const { claw } = g;
    const keys = keysRef.current;

    // Handle keyboard movement
    let dir = g.moveDirection;
    if (keys.has('ArrowLeft') || keys.has('a')) dir = -1;
    else if (keys.has('ArrowRight') || keys.has('d')) dir = 1;
    else if (g.moveDirection === 0) dir = 0;

    if (keys.has(' ') && !claw.dropping && !claw.returning) {
      dropClaw();
      keys.delete(' ');
    }

    // Move claw horizontally
    if (!claw.dropping && !claw.returning && dir !== 0) {
      claw.x += dir * CLAW_SPEED;
      claw.x = Math.max(g.machineLeft + 30, Math.min(g.machineRight - 50, claw.x));
      // Add swing when moving
      claw.swingSpeed += dir * SWING_FORCE;
    }

    // Swing physics
    claw.swingAngle += claw.swingSpeed;
    claw.swingSpeed *= SWING_DAMPING;
    claw.swingSpeed -= claw.swingAngle * 0.01; // spring back

    // Drop phase
    if (claw.dropping) {
      claw.y += DROP_SPEED;
      if (claw.y >= claw.dropY) {
        claw.y = claw.dropY;
        claw.dropping = false;
        claw.open = false;
        claw.grabbing = true;

        // Check grab
        const clawTipX = claw.x + Math.sin(claw.swingAngle) * 8;
        const clawTipY = claw.y + 30;
        let closestPrize: Prize | null = null;
        let closestDist = Infinity;

        for (const prize of g.prizes) {
          if (prize.grabbed) continue;
          const dx = prize.x - clawTipX;
          const dy = prize.y - clawTipY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 35 && dist < closestDist) {
            closestDist = dist;
            closestPrize = prize;
          }
        }

        if (closestPrize && Math.random() < GRAB_CHANCE) {
          closestPrize.grabbed = true;
          claw.grabbedPrize = closestPrize;
        }

        claw.returning = true;
      }
    }

    // Return phase
    if (claw.returning) {
      claw.y -= RETURN_SPEED;
      if (claw.y <= g.machineTop + 40) {
        claw.y = g.machineTop + 40;

        if (claw.grabbedPrize) {
          // Move toward chute
          const chuteX = g.machineRight - 35;
          if (Math.abs(claw.x - chuteX) > 3) {
            claw.x += (chuteX > claw.x ? 1 : -1) * CLAW_SPEED;
            return; // keep returning to chute
          }

          // Prize collected!
          const prize = claw.grabbedPrize;
          const points = PRIZE_INFO[prize.type].points;
          g.score += points;
          g.collection.push(prize.type);
          setScore(g.score);
          setCollection([...g.collection]);
          saveState(g.score, g.collection);
          showMessage(`+${points} ${PRIZE_INFO[prize.type].emoji} ${PRIZE_INFO[prize.type].label}!`);
          claw.grabbedPrize = null;
        } else {
          showMessage('Nothing grabbed... try again!');
        }

        claw.returning = false;
        claw.grabbing = false;
        claw.open = true;
        setCanDrop(true);

        // Replenish prizes if low
        const remaining = g.prizes.filter(p => !p.grabbed).length;
        if (remaining < 5) {
          g.prizes = generatePrizes(g.machineLeft, g.machineRight, g.machineBottom);
        }
      }
    }

    // Decrement message timer
    if (g.messageTimer > 0) g.messageTimer--;

    drawGame();
    animFrameRef.current = requestAnimationFrame(update);
  }, [drawGame, dropClaw, showMessage]);

  useEffect(() => {
    initGame();
    animFrameRef.current = requestAnimationFrame(update);

    const handleResize = () => {
      initGame();
    };

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
      <div className="flex flex-col items-center gap-2 w-full max-w-[420px]">
        <canvas
          ref={canvasRef}
          className="w-full rounded-xl border-2 border-teal-500/30 shadow-[0_0_40px_rgba(20,184,166,0.15)]"
          style={{ aspectRatio: '3/4', maxHeight: '70vh' }}
        />

        {/* Mobile controls */}
        <div className="flex gap-3 w-full max-w-[320px]">
          <button
            className="flex-1 h-14 rounded-xl bg-[#1e293b] border-2 border-teal-500/50 text-teal-400 text-2xl font-bold active:bg-teal-500/20 transition-colors touch-none"
            onPointerDown={() => handleMoveStart(-1)}
            onPointerUp={handleMoveEnd}
            onPointerLeave={handleMoveEnd}
            aria-label="Move left"
          >
            ◀
          </button>
          <button
            className="flex-[2] h-14 rounded-xl bg-[#1e293b] border-2 border-orange-500/50 text-orange-400 text-lg font-bold active:bg-orange-500/20 transition-colors disabled:opacity-30 touch-none"
            onPointerDown={dropClaw}
            disabled={!canDrop}
            aria-label="Drop claw"
          >
            🎯 DROP
          </button>
          <button
            className="flex-1 h-14 rounded-xl bg-[#1e293b] border-2 border-teal-500/50 text-teal-400 text-2xl font-bold active:bg-teal-500/20 transition-colors touch-none"
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
        <div className="rounded-xl bg-[#1e293b]/80 border border-teal-500/20 p-4">
          <h2 className="text-teal-400 font-bold text-sm uppercase tracking-wider mb-2">Score</h2>
          <p className="text-3xl font-bold text-orange-400">{score}</p>
        </div>

        {/* Message */}
        {message && (
          <div className="rounded-xl bg-orange-500/10 border border-orange-500/30 p-3 text-center text-orange-300 text-sm font-medium animate-pulse">
            {message}
          </div>
        )}

        {/* Prize collection */}
        <div className="rounded-xl bg-[#1e293b]/80 border border-teal-500/20 p-4">
          <h2 className="text-teal-400 font-bold text-sm uppercase tracking-wider mb-3">Prize Collection</h2>
          {collection.length === 0 ? (
            <p className="text-slate-500 text-sm">No prizes yet! Drop the claw to win.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {Object.entries(collectionCounts).map(([type, count]) => (
                <div key={type} className="flex items-center gap-2 text-sm">
                  <span className="text-xl">{PRIZE_INFO[type as PrizeType].emoji}</span>
                  <span className="text-slate-300">{PRIZE_INFO[type as PrizeType].label}</span>
                  <span className="ml-auto text-teal-400 font-mono">×{count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Reset */}
        <button
          className="rounded-lg bg-[#1e293b]/50 border border-slate-600/30 px-3 py-2 text-slate-500 text-xs hover:text-slate-300 hover:border-slate-500/50 transition-colors"
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
