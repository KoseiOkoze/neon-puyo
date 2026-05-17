"use client";

import React, { useState, useEffect, useCallback, useRef } from 'react';

// --- Constants ---
const ROWS = 12;
const COLS = 6;
const COLORS = ['red', 'blue', 'green', 'yellow', 'purple'] as const;
type PuyoColor = typeof COLORS[number];
type Rotation = 0 | 90 | 180 | 270;

type Puyo = { color: PuyoColor; isPopping?: boolean };
type Grid = (Puyo | null)[][];
type PuyoPair = { x: number; y: number; color1: PuyoColor; color2: PuyoColor; rotation: Rotation };

const PUYO_STYLE: Record<PuyoColor, string> = {
  red:    'bg-red-500 neon-red',
  blue:   'bg-blue-500 neon-blue',
  green:  'bg-green-500 neon-green',
  yellow: 'bg-yellow-400 neon-yellow',
  purple: 'bg-purple-500 neon-purple',
};

const rnd = (): PuyoColor => COLORS[Math.floor(Math.random() * COLORS.length)];
const emptyGrid = (): Grid => Array.from({ length: ROWS }, () => Array(COLS).fill(null));

// Returns [[x1,y1], [x2,y2]] — pivot is always pos1, second puyo is pos2
function pairCells(p: PuyoPair): [[number, number], [number, number]] {
  switch (p.rotation) {
    case 0:   return [[p.x, p.y], [p.x,     p.y - 1]];
    case 90:  return [[p.x, p.y], [p.x + 1, p.y    ]];
    case 180: return [[p.x, p.y], [p.x,     p.y + 1]];
    case 270: return [[p.x, p.y], [p.x - 1, p.y    ]];
  }
}

// y < 0 = above the grid, which is valid (pair spawns partially off-screen)
function cellOK(x: number, y: number, grid: Grid): boolean {
  if (x < 0 || x >= COLS || y >= ROWS) return false;
  if (y < 0) return true;
  return grid[y][x] === null;
}

function canMovePair(p: PuyoPair, dx: number, dy: number, grid: Grid): boolean {
  const [[x1, y1], [x2, y2]] = pairCells({ ...p, x: p.x + dx, y: p.y + dy });
  return cellOK(x1, y1, grid) && cellOK(x2, y2, grid);
}

// Returns same reference if nothing moved — enables cheap change detection
function applyGravity(grid: Grid): Grid {
  let changed = false;
  const g = grid.map(r => [...r]);
  for (let x = 0; x < COLS; x++) {
    let wy = ROWS - 1;
    for (let y = ROWS - 1; y >= 0; y--) {
      if (g[y][x]) {
        if (y !== wy) { g[wy][x] = g[y][x]; g[y][x] = null; changed = true; }
        wy--;
      }
    }
  }
  return changed ? g : grid;
}

function findGroups(grid: Grid): [number, number][] {
  const result: [number, number][] = [];
  const seen = new Set<string>();
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const p = grid[y][x];
      if (!p || seen.has(`${x},${y}`)) continue;
      const group: [number, number][] = [];
      const q: [number, number][] = [[x, y]];
      seen.add(`${x},${y}`);
      while (q.length) {
        const [cx, cy] = q.shift()!;
        group.push([cx, cy]);
        for (const [nx, ny] of [[cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]] as [number,number][]) {
          if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS &&
              grid[ny][nx]?.color === p.color && !seen.has(`${nx},${ny}`)) {
            seen.add(`${nx},${ny}`); q.push([nx, ny]);
          }
        }
      }
      if (group.length >= 4) result.push(...group);
    }
  }
  return result;
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export default function Game() {
  const [grid, setGrid]             = useState<Grid>(emptyGrid());
  const [pair, setPair]             = useState<PuyoPair | null>(null);
  const [nextColors, setNextColors] = useState<[PuyoColor, PuyoColor]>([rnd(), rnd()]);
  const [score, setScore]           = useState(0);
  const [bestChain, setBestChain]   = useState(0);
  const [chainBanner, setChainBanner] = useState(0);
  const [phase, setPhase]           = useState<'idle' | 'playing' | 'chaining' | 'gameover' | 'paused'>('idle');

  // Mutable refs — always in sync with state, read synchronously in callbacks to avoid stale closures
  const G  = useRef(grid);
  const P  = useRef(pair);
  const NC = useRef(nextColors);
  const PH = useRef(phase);

  useEffect(() => { G.current  = grid;       }, [grid]);
  useEffect(() => { P.current  = pair;       }, [pair]);
  useEffect(() => { NC.current = nextColors; }, [nextColors]);
  useEffect(() => { PH.current = phase;      }, [phase]);

  const spawn = useCallback((g: Grid, colors: [PuyoColor, PuyoColor]) => {
    if (g[0][2] || g[1][2]) {
      setPhase('gameover'); PH.current = 'gameover';
      return;
    }
    const newPair: PuyoPair = { x: 2, y: 1, color1: colors[0], color2: colors[1], rotation: 0 };
    const next: [PuyoColor, PuyoColor] = [rnd(), rnd()];
    setPair(newPair); P.current = newPair;
    setNextColors(next); NC.current = next;
  }, []);

  const process = useCallback(async (g: Grid) => {
    setPhase('chaining'); PH.current = 'chaining';
    let cur = g;
    let chain = 0;

    for (;;) {
      // 1. Gravity (also resolves ちぎれ separation)
      const dropped = applyGravity(cur);
      if (dropped !== cur) {
        setGrid(dropped);
        await sleep(180);
        cur = dropped;
      }

      // 2. Find groups ≥4
      const hits = findGroups(cur);
      if (!hits.length) break;

      // 3. Pop animation
      const popping: Grid = cur.map(r => r.map(c => c ? { ...c } : null));
      hits.forEach(([x, y]) => { if (popping[y][x]) popping[y][x]!.isPopping = true; });
      setGrid(popping);
      await sleep(400);

      // 4. Remove & score
      cur = popping.map(r => r.map(c => c?.isPopping ? null : c ? { color: c.color } : null));
      chain++;
      setScore(s => s + hits.length * 10 * chain);
      setBestChain(b => Math.max(b, chain));
      setChainBanner(chain);
      setGrid(cur);
      await sleep(80);
    }

    setTimeout(() => setChainBanner(0), 900);
    G.current = cur;
    setPhase('playing'); PH.current = 'playing';
    spawn(cur, NC.current);
  }, [spawn]);

  const lock = useCallback(() => {
    const p = P.current;
    if (!p) return;
    const [[x1, y1], [x2, y2]] = pairCells(p);
    const ng = G.current.map(r => [...r]);
    if (y1 >= 0 && y1 < ROWS) ng[y1][x1] = { color: p.color1 };
    if (y2 >= 0 && y2 < ROWS) ng[y2][x2] = { color: p.color2 };
    setPair(null); P.current = null;
    setGrid(ng); G.current = ng;
    process(ng);
  }, [process]);

  const drop = useCallback(() => {
    if (PH.current !== 'playing') return;
    const p = P.current;
    if (!p) return;
    if (canMovePair(p, 0, 1, G.current)) {
      const moved = { ...p, y: p.y + 1 };
      setPair(moved); P.current = moved;
    } else {
      lock();
    }
  }, [lock]);

  const togglePause = useCallback(() => {
    if (PH.current === 'playing') {
      setPhase('paused'); PH.current = 'paused';
    } else if (PH.current === 'paused') {
      setPhase('playing'); PH.current = 'playing';
    }
  }, []);

  const moveH = useCallback((dir: -1 | 1) => {
    if (PH.current !== 'playing') return;
    const p = P.current;
    if (!p) return;
    if (canMovePair(p, dir, 0, G.current)) {
      const moved = { ...p, x: p.x + dir };
      setPair(moved); P.current = moved;
    }
  }, []);

  const rot = useCallback(() => {
    if (PH.current !== 'playing') return;
    const p = P.current;
    if (!p) return;
    const nr = ((p.rotation + 90) % 360) as Rotation;
    // Try rotation with wall kicks: center, left, right, up
    for (const [dx, dy] of [[0,0],[-1,0],[1,0],[0,-1]] as [number,number][]) {
      const t = { ...p, x: p.x + dx, y: p.y + dy, rotation: nr };
      const [[x1,y1],[x2,y2]] = pairCells(t);
      if (cellOK(x1,y1,G.current) && cellOK(x2,y2,G.current)) {
        setPair(t); P.current = t;
        return;
      }
    }
  }, []);

  const startGame = useCallback(() => {
    const g = emptyGrid();
    const nc: [PuyoColor, PuyoColor] = [rnd(), rnd()];
    setGrid(g); G.current = g;
    setScore(0); setBestChain(0); setChainBanner(0);
    setPhase('playing'); PH.current = 'playing';
    NC.current = nc;
    spawn(g, nc);
  }, [spawn]);

  // Game loop
  useEffect(() => {
    if (phase !== 'playing') return;
    const id = setInterval(drop, 800);
    return () => clearInterval(id);
  }, [phase, drop]);

  // Keyboard controls
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowLeft':  e.preventDefault(); moveH(-1);    break;
        case 'ArrowRight': e.preventDefault(); moveH(1);     break;
        case 'ArrowDown':  e.preventDefault(); drop();       break;
        case 'ArrowUp':    e.preventDefault(); rot();        break;
        case 'p':
        case 'P':          e.preventDefault(); togglePause(); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moveH, drop, rot, togglePause]);

  // Build overlay map for the active pair
  const overlay = new Map<string, PuyoColor>();
  if (pair) {
    const [[x1,y1],[x2,y2]] = pairCells(pair);
    if (y1 >= 0) overlay.set(`${x1},${y1}`, pair.color1);
    if (y2 >= 0) overlay.set(`${x2},${y2}`, pair.color2);
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      <div className="bg-gradient" />
      <div className="mesh-gradient" />

      {/* Chain Banner */}
      {chainBanner > 0 && (
        <div className="chain-banner">
          <span className="chain-text">{chainBanner} CHAIN!</span>
        </div>
      )}

      {/* Left HUD */}
      <div className="absolute left-8 top-1/2 -translate-y-1/2 flex flex-col gap-6 w-44">
        <div className="glass p-5 flex flex-col items-center">
          <span className="hud-label text-blue-400">Score</span>
          <span className="hud-value">{score.toLocaleString()}</span>
        </div>
        <div className="glass p-5 flex flex-col items-center">
          <span className="hud-label text-purple-400">Best Chain</span>
          <span className="hud-value">{bestChain}</span>
        </div>
      </div>

      {/* Game Board */}
      <div className="relative group">
        <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl blur opacity-25 group-hover:opacity-50 transition duration-1000" />
        <div className="relative glass p-2">
          {phase === 'paused' && (
            <div
              className="absolute inset-0 rounded-2xl flex flex-col items-center justify-center gap-3 z-10"
              style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)' }}
            >
              <span
                className="text-5xl font-black tracking-widest text-white"
                style={{ textShadow: '0 0 20px rgba(255,255,255,0.6)' }}
              >
                ⏸ PAUSE
              </span>
              <span className="text-xs font-bold text-white/50 tracking-widest uppercase">
                P キーで再開
              </span>
            </div>
          )}
          <div className="game-grid">
            {Array.from({ length: ROWS }, (_, y) =>
              Array.from({ length: COLS }, (_, x) => {
                const gp = grid[y][x];
                const oc = overlay.get(`${x},${y}`);
                const color = gp?.color ?? oc ?? null;
                return (
                  <div key={`${x}-${y}`}>
                    {color && (
                      <div className={`puyo-cell ${PUYO_STYLE[color]} ${gp?.isPopping ? 'puyo-pop' : oc ? 'puyo-active' : ''}`}>
                        <div className="puyo-inner" />
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Right HUD */}
      <div className="absolute right-8 top-1/2 -translate-y-1/2 flex flex-col gap-6 w-44">
        <div className="glass p-5 flex flex-col items-center">
          <span className="hud-label text-green-400 mb-4">Next</span>
          <div className="flex flex-col gap-2 items-center">
            {/* Display color2 on top (it's above color1 in rotation=0) */}
            <div className={`w-10 h-10 rounded-full ${PUYO_STYLE[nextColors[1]]} shadow-lg`} />
            <div className={`w-10 h-10 rounded-full ${PUYO_STYLE[nextColors[0]]} shadow-lg`} />
          </div>
        </div>

        {(phase === 'playing' || phase === 'paused') && (
          <button
            onClick={togglePause}
            className="glass p-3 text-sm font-bold text-white/70 hover:text-white hover:bg-white/10 transition cursor-pointer text-center rounded-2xl tracking-widest uppercase"
          >
            {phase === 'paused' ? '▶ RESUME' : '⏸ PAUSE'}
          </button>
        )}

        {phase === 'idle' && (
          <button
            onClick={startGame}
            className="glass p-5 text-lg font-bold text-white hover:bg-white/10 transition cursor-pointer text-center rounded-2xl"
          >
            START GAME
          </button>
        )}

        {phase === 'gameover' && (
          <div className="glass p-5 flex flex-col items-center gap-3">
            <span className="text-red-400 font-bold text-lg">GAME OVER</span>
            <button
              onClick={startGame}
              className="text-sm font-bold text-white hover:text-yellow-400 transition cursor-pointer"
            >
              RETRY
            </button>
          </div>
        )}
      </div>

      {/* Controls Guide */}
      <div className="absolute bottom-6 glass px-6 py-3 flex gap-6 text-xs font-bold text-white/50 tracking-widest uppercase">
        <span><span className="key">↑</span> Rotate</span>
        <span><span className="key">←→</span> Move</span>
        <span><span className="key">↓</span> Fast Drop</span>
        <span><span className="key">P</span> Pause</span>
      </div>
    </main>
  );
}
