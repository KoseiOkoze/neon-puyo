# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev      # Start dev server (localhost:3000)
npm run build    # Production build
npm run start    # Start production server
npm run lint     # Run ESLint
```

## Stack

- **Next.js 16.2.6** (App Router) + **React 19.2.4** — newer version with breaking changes. Read `node_modules/next/dist/docs/` before using unfamiliar APIs.
- **Tailwind CSS v4** — configured via `postcss.config.mjs` with `@tailwindcss/postcss`. No `tailwind.config.js`; custom utilities live in `globals.css` using `@layer`.
- **TypeScript** strict mode. Path alias `@/*` → `src/*`.

## Architecture

All game logic and UI live in a single Client Component: `src/app/page.tsx` (`"use client"`).

**State pattern:** React state drives rendering; mutable refs (e.g. `G`, `P`, `PH`) hold the same values and are read synchronously inside `useCallback`/`setInterval` to avoid stale closures in the async chain-processing loop.

**Core types:**
- `Grid = (Puyo | null)[][]` — 12×6 board
- `PuyoPair` — active falling piece: `{ x, y, color1, color2, rotation: 0|90|180|270 }`
- `phase: 'idle' | 'playing' | 'chaining' | 'gameover'`

**Game loop flow:**
1. `setInterval(drop, 800ms)` runs while `phase === 'playing'`
2. On collision `lock()` places both puyos into `grid`, then calls `process()`
3. `process()` is an `async` loop: `gravity()` → BFS for groups ≥4 → pop animation (400ms) → remove → repeat; updates score/chain on each iteration; calls `spawn()` when done
4. `gravity()` compacts each column downward — this implements ちぎれ (separation) automatically

**Key pure helpers** (all in `page.tsx`):
- `pairCells(pair)` — returns `[[x1,y1],[x2,y2]]` for the pivot + second puyo
- `cellOK(x, y, grid)` — bounds + occupancy check; `y < 0` is always OK (above grid)
- `canMovePair(pair, dx, dy, grid)` — checks both cells after offset
- `gravity(grid)` — returns same reference if nothing moved (enables cheap change detection)
- `findGroups(grid)` — BFS flood-fill returning all cells in groups ≥4

**CSS design tokens** in `globals.css`: `--accent-*` colors, `.glass` glassmorphism, `.neon-*` glow classes, `.game-grid` (fixed 320×640px CSS Grid), `.puyo-pop` / `.puyo-drop` animations.

**Color→style mapping:** `PUYO_STYLE: Record<PuyoColor, string>` maps each color to Tailwind bg class + neon class.

## NEON PUYO 要件定義

### デザイン・UI/UX
- グラスモーフィズム（半透明＋背景ブラー）、ネオンエフェクト（重要要素を発光）
- メッシュグラデーション背景、ぷよ落下・消滅のCSS/JSアニメーション

### ゲームシステム
- グリッド: 縦12行 × 横6列 / ぷよ5色（赤・青・緑・黄・紫）
- 操作: ← → 移動、↑ 回転（壁キックあり）、↓ 高速落下
- ちぎれ判定: ロック後に `gravity()` で自動解決
- 消滅: 同色4つ以上連結 → 連鎖（チェーン）ループ
- スコア: `消去数 × 10 × 連鎖番号`（倍率増加）
- ゲームオーバー: 出現口 col=2, row=0-1 が埋まった時
- RETRY: ゲームオーバー後に再挑戦可能
