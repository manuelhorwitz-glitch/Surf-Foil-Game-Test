# Surf Foil Game - Project Context

## What This Project Is

A browser-based 3D surf-foiling game inspired by True Surf. The goal is to create a fun, flowy experience where players ride a hydrofoil on ocean waves — carving, snapping, doing cutbacks, and racing sections.

## Current State (Working Prototype)

The game currently lives in a **single file**: `src/App.tsx` (~303 lines). It has solid foil physics and a single diagonal wave on the ocean surface (visual only — physics still reference flat y=0). The physics feel good and should be preserved as the foundation.

### Tech Stack & Dependencies
- **React 19 + TypeScript** (~5.8.2, target ES2022, JSX: react-jsx)
- **Three.js v0.183.1** via `@react-three/fiber` v9.5.0
- **@react-three/drei** v10.7.7 (Sky, Trail — many more available: Environment, shaderMaterial, CameraShake, etc.)
- **Vite** v6.2.0 (dev server on port 3000, `npm run dev`)
- **Tailwind CSS** v4.1.14 (via `@tailwindcss/vite` plugin, imported in `src/index.css` as `@import "tailwindcss"`)
- **Motion** v12.23.24 (animation library, installed but not currently used)
- **Lucide React** v0.546.0 (icons, installed but not currently used)

Installed but NOT used in the game (leftover from Google AI Studio scaffolding):
- `@google/genai`, `express`, `better-sqlite3`, `dotenv` — can be ignored or removed

### Build & Config
- **Entry point**: `src/main.tsx` → renders `<App />` in StrictMode into `#root`
- **Vite config** (`vite.config.ts`): React plugin + Tailwind plugin, path alias `@/` → project root, optional HMR disable via `DISABLE_HMR` env var (for AI Studio)
- **TypeScript config** (`tsconfig.json`): ES2022 target, bundler module resolution, `noEmit` (type-check only), path alias `@/*`
- **No testing framework** is set up
- **No database** — this is a pure client-side game, no backend
- **No CI/CD** configured

### NPM Scripts
```bash
npm run dev      # Start dev server at http://localhost:3000
npm run build    # Production build to dist/
npm run preview  # Preview production build
npm run clean    # Delete dist/
npm run lint     # TypeScript type-check (tsc --noEmit)
```

### How to Run
```bash
cd Surf-Foil-Game-Test
npm install
npm run dev
# Opens at http://localhost:3000
```

### Controls
- **W / ArrowUp**: Pitch nose down (drop in, gain speed, lose lift)
- **S / ArrowDown**: Pitch nose up (generate lift, slow down)
- **A / ArrowLeft**: Carve left (roll angle 0.55 rad)
- **D / ArrowRight**: Carve right (roll angle -0.55 rad)
- **Shift**: Hold while carving to snap (sharp turn, 2.5x turn multiplier, heavy speed penalty)

### Game States
- `'start'`: Title screen with controls tutorial
- `'playing'`: Active gameplay
- `'gameover'`: Wipeout screen showing crash reason

### Current Physics (in `src/App.tsx`, lines 62-180)

All physics run in a `useFrame` loop on a `stateRef` with these properties:
- `pitch`, `roll`, `yaw` — orientation (lerped toward targets for smooth feel)
- `height` — vertical position above water (currently absolute, flat water at y=0)
- `vY` — vertical velocity
- `speed` — forward speed (1.0 - 25.0 m/s range)
- `prevPitch`, `prevRoll` — for computing rates of change

**Speed generation:**
- Thrust from pumping: `pitchRate * 5.5` (deliberate pitch oscillation)
- Thrust from rail transitions: `rollRate * 0.5` (quick carve switches)
- Drag: base (`speed * 0.08`) + stall (`pitch * speed * 1.2`) + carve (`|roll| * speed * 0.2`)
- Snap penalty: `speed * 2.5` (massive drag when shift-carving)

**Vertical physics:**
- Base lift: `(speed / 10.0) * gravity` — faster = more lift
- Pitch lift: `pitch * speed * 3.0` — nose up = more lift (but bleeds speed)
- Ground effect: push up below 0.3m, pull down above 1.0m (creates a "safe zone")
- Vertical damping: `vY *= 0.85` per frame

**Crash conditions:**
- TOUCHDOWN: `height <= -0.05` (board hits water)
- BREACHED: `height >= 1.3` (foil wing exits water)
- No stall speed crash — going slow just naturally sinks you

**Turning:**
- `yaw += roll * dt * 5.5 * snapMultiplier * speedFactor`
- Speed factor: slower = turns easier (inversely proportional above 10 m/s)

**Camera:**
- Chase cam from behind the player
- Camera yaw lerps toward player yaw at `dt * 2.5`
- Offset: 2.5m up, 6m behind, rotated by camera yaw
- Position lerps at `dt * 5`
- Looks at player position + 0.5m Y offset

### Visual Setup
- **Board**: Orange box (0.5 x 0.05 x 1.5)
- **Mast**: Gray box below board (0.05 x 1.2 x 0.2)
- **Foil wings**: Two black boxes at mast base
- **Trail**: Blue glowing trail from rear stabilizer (40-unit length)
- **Scene**: Procedural Sky, 1000x1000 ocean with single diagonal wave (WaveMesh component)
- **Lighting**: Ambient (0.5) + directional with shadows (1.5 intensity)

### Wave (Visual Only — Phase 1 Complete)

A single diagonal wave hump rendered on the ocean surface. Physics do NOT interact with it yet — the player still flies relative to y=0 and clips through the wave geometry.

**Wave math** (`getWaveHeight(x, z)` in App.tsx):
- CPU-side function shared between rendering (and later physics)
- Cosine envelope: single hump centered at d=0, falls to zero at d=±5m
- `d = x * cos(30°) + z * sin(30°)` — projects position onto the 30° diagonal wave direction
- Height = `1.2 * cos(dNorm * PI/2)^1.5` where `dNorm = d / 5`

**Wave parameters:**
| Parameter | Value | Purpose |
|-----------|-------|---------|
| Amplitude | 1.2m | ~3-4ft wave face |
| Width | 10m | Total width perpendicular to crest |
| Angle | 30° (PI/6) | Diagonal orientation for right-hand wave |

**WaveMesh component:**
- PlaneGeometry(1000, 1000, 200, 200) — 40K vertices
- Vertices deformed every frame via `useFrame` using `getWaveHeight`
- Normals recomputed each frame for correct lighting
- `meshStandardMaterial` with DoubleSide rendering

**Next steps (not yet implemented):**
1. Make the player's Y position track the wave surface (`surfaceY + height`)
2. Add slope-based speed (downhill = accelerate, uphill = decelerate)
3. Add wave propagation (moving wave) and breaking
4. Visual polish (shader, foam, lighting)

### Key Physics Tuning Values
| Parameter | Value | Purpose |
|-----------|-------|---------|
| Initial speed | 12 m/s | Comfortable start |
| Pitch lerp | dt * 5.0 | Responsive but smooth |
| Roll lerp | dt * 6.0 | Quick carving |
| Base turn rate | 5.5 rad/sec | Tight carving |
| Snap multiplier | 2.5x | Sharp aggressive turns |
| Ground effect low | 0.3m | Push up near water |
| Ground effect high | 1.0m | Pull down from surface |
| vY damping | 0.85 | Prevents bouncing |

## The Big Goal: Add a Wave

The next major feature is adding a rideable ocean wave so the player can surf on it — carving up and down the face, doing snaps at the lip, cutbacks, and racing sections.

### Design Intent
- **Wave type**: Single direction, clean point-break wave (like J-Bay)
- **Wave size**: Small & fun (3-4ft / ~1.2m amplitude) to start
- **Camera**: Start with the existing chase cam (side-on cinematic camera can be explored later, but it was disorienting without a developed wave)
- **Feel**: Flowy, fun, True Surf-inspired

### What We Tried and Learned

We attempted a first implementation that didn't work well. Key lessons:

1. **Starting orientation matters**: The player starts facing -Z (yaw=0). The wave was centered at z=0. Starting the player on the wave face without aligning their yaw to ride along the wave (should be yaw=PI/2 for +X direction) caused them to ride straight into the wave slope, which felt like being pushed backwards.

2. **Wave slope physics need careful tuning**: We added `waveSlopeThrust = -slopeInDirection * gravity * 0.8` to make going downhill = speed gain. The formula projected the wave slope onto the player's forward direction. The concept is right but the interaction with the existing pumping physics needs balancing — the wave slope was overwhelming the pump-based speed system.

3. **Camera matters a lot**: We tried a side-on cinematic camera (True Surf style) but it was very disorienting without a fully developed wave to give visual context. The chase cam from behind is much better for development and testing. Keep it for now.

4. **Incremental approach is essential**: Trying to add wave geometry + wave physics + new camera all at once made it hard to debug what was wrong. Better to add one thing at a time and test.

### Abandoned Files (Can Be Deleted or Reused)

These files were created during the first wave attempt and are NOT currently used by `App.tsx`:
- `src/types.ts` — shared TypeScript interfaces (GameState, WaveParams, WaveSample, PlayerState)
- `src/systems/waveFunction.ts` — `sampleWave()` with cosine envelope wave shape
- `src/components/Wave.tsx` — deformable wave mesh component
- `src/components/Player.tsx` — player with wave-adapted physics
- `src/components/Camera.tsx` — chase camera component (was also tried as side-on)
- `src/components/HUD.tsx` — extracted HUD component

The wave function math in `waveFunction.ts` is sound — cosine envelope for the wave cross-section, finite-difference slope computation, surface normal calculation. It can be reused.

### Recommended Approach for the Wave

When implementing the wave, the key architectural decision is:

**Keep wave math on the CPU** so both the renderer and physics can share the exact same `sampleWave()` function. This avoids mismatches between where the wave looks like it is and where the physics think it is.

**Suggested incremental phases:**
1. ~~Add just the visual wave mesh (no physics changes) — verify it looks right~~ **DONE** (single diagonal wave via `getWaveHeight` + `WaveMesh`)
2. Make the player's Y position track the wave surface — verify they ride on it
3. Add slope-based speed — verify carving up/down the face feels right
4. Add wave propagation and breaking — verify racing sections works
5. Visual polish (custom shader, foam, lighting)

### Important: Player Direction Convention
- `yaw = 0` → player faces -Z direction (`forward = (0, 0, -1)`)
- `yaw = PI/2` → player faces +X direction
- The wave face should extend along whichever axis the player rides parallel to
- If wave peak is at z=0 extending along X, the player should start with `yaw = PI/2` to ride along the face

---

## Full File Structure

```
Surf-Foil-Game-Test/
├── index.html                    # HTML shell with #root div
├── package.json                  # Dependencies and scripts
├── tsconfig.json                 # TypeScript config (ES2022, react-jsx)
├── vite.config.ts                # Vite + React + Tailwind plugins
├── PROJECT_CONTEXT.md            # This file
├── metadata.json                 # App metadata (from Google AI Studio)
├── README.md                     # Basic readme
├── src/
│   ├── main.tsx                  # Entry point: renders <App /> in StrictMode
│   ├── index.css                 # Just `@import "tailwindcss"`
│   ├── App.tsx                   # *** THE ENTIRE GAME (303 lines) ***
│   │
│   ├── types.ts                  # [UNUSED] Shared TS interfaces from wave attempt
│   ├── systems/
│   │   └── waveFunction.ts       # [UNUSED] sampleWave() math from wave attempt
│   └── components/
│       ├── Player.tsx            # [UNUSED] Player with wave physics from wave attempt
│       ├── Wave.tsx              # [UNUSED] Deformable wave mesh from wave attempt
│       ├── Camera.tsx            # [UNUSED] Camera component from wave attempt
│       └── HUD.tsx               # [UNUSED] HUD component from wave attempt
```

**Note**: Only `src/App.tsx`, `src/main.tsx`, and `src/index.css` are actively used. Everything in `components/` and `systems/` is from the abandoned wave attempt and is NOT imported by `App.tsx`.

---

## Important Rules & Principles

1. **The existing physics feel good** — preserve them. Any wave implementation should build ON TOP of the current pump/carve/snap speed system, not replace it.

2. **Incremental changes only** — add one feature at a time and test. Don't combine wave geometry + wave physics + camera changes in one go.

3. **Keep the chase cam** for now. A side-on cinematic camera (True Surf style) can be revisited once the wave is fully working, but it's disorienting during development.

4. **CPU-side wave math** — the wave height function must be callable from both the rendering code AND the physics code. Don't put wave deformation in a GPU shader only.

5. **No backend needed** — this is a pure client-side browser game. Ignore the express/sqlite/genai dependencies.

6. **Test with `npm run dev`** — Vite hot-reloads changes instantly at http://localhost:3000.

7. **Type-check with `npm run lint`** — runs `tsc --noEmit` to catch type errors without building.
