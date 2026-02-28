# Surf Foil Game - Project Context

## What This Project Is

A browser-based 3D surf-foiling game inspired by True Surf. The goal is to create a fun, flowy experience where players ride a hydrofoil on ocean waves — carving, snapping, doing cutbacks, and racing sections.

## Current State (Working Prototype)

The game currently lives in a **single file**: `src/App.tsx` (~382 lines). The player rides on a moving wave with full slope-based physics, foil catch mechanics, and a beach/drone camera angle.

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
- **A / ArrowLeft**: Bottom turn (up the face toward the lip, roll angle 0.55 rad)
- **D / ArrowRight**: Snap/cutback (down the face toward flat water, roll angle -0.55 rad)
- **Shift**: Hold while carving to snap (sharp turn, 2.5x turn multiplier, heavy speed penalty)

### Game States
- `'start'`: Title screen with controls tutorial
- `'playing'`: Active gameplay
- `'gameover'`: Wipeout screen showing crash reason

### Current Physics (in `src/App.tsx`)

All physics run in a `useFrame` loop on a `stateRef` with these properties:
- `pitch`, `roll`, `yaw` — orientation (lerped toward targets for smooth feel)
- `height` — vertical position above **wave surface** (relative to wave, not absolute)
- `vY` — vertical velocity
- `speed` — forward speed (1.0 - 25.0 m/s range)
- `prevPitch`, `prevRoll` — for computing rates of change

**Speed generation (3 sources):**

1. **Wave slope thrust** (primary): `waveSlopeThrust = -slopeInDirection * GRAVITY * 0.35`
   - Projects wave gradient onto player's forward direction
   - Downhill = positive thrust, uphill = negative thrust
   - Uses `getWaveSlope()` finite-difference gradient (EPSILON=0.05)

2. **Foil catch thrust**: `foilCatchThrust = slopeMag * 1.5 * (1.0 - 0.5 * uphillRatio)`
   - Foil extracts energy from the wave face based on slope steepness
   - Direction-aware: full effect downhill/sideways, halved going uphill
   - Makes bottom turns feel powerful rather than purely punishing

3. **Pump thrust** (supplemental): `pumpThrust = (pitchRate * 3.5) + (rollRate * 0.3)`
   - Pitch oscillation and rail transitions generate speed
   - Reduced from original values since wave is now primary speed source

**Drag:** base (`speed * 0.08`) + stall (`pitch * speed * 1.2`) + carve (`|roll| * speed * 0.2`) + snap penalty (`speed * 2.5` when shift-carving)

**Vertical physics:**
- Base lift: `(speed / 10.0) * GRAVITY` — faster = more lift
- Pitch lift: `pitch * speed * 3.0` — nose up = more lift (but bleeds speed)
- Ground effect: push up below 0.3m, pull down above 1.0m (creates a "safe zone")
- Wave face lift: `slopeMag * GRAVITY * 0.2` — steeper face = more lift = need to pitch down
- Vertical damping: `vY *= 0.85` per frame

**Player Y position**: `position.y = getWaveHeight(x, z, t) + height` — player rides ON the wave surface

**Crash conditions:**
- TOUCHDOWN: `height <= -0.05` (board hits water)
- BREACHED: `height >= 1.3` (foil wing exits water)
- No stall speed crash — going slow just naturally sinks you

**Turning:**
- `yaw += roll * dt * 5.5 * snapMultiplier * speedFactor`
- Speed factor: slower = turns easier (inversely proportional above 10 m/s)

**Camera (beach/drone view):**
- Fixed angle relative to wave direction (not player yaw)
- Camera positioned on the shore side looking back at the wave face
- Offset: 10m toward shore, 5m along crest, 3m above player
- Position lerps at `dt * 3`
- Looks at player position + 0.5m Y offset

### Wave System

**Wave propagation:**
- Wave moves along its diagonal direction at `WAVE_SPEED` m/s
- Time parameter added to `getWaveHeight(x, z, t)`: `d = x * DIR_X + z * DIR_Z - WAVE_SPEED * t`
- Both physics and rendering use the same time-aware function
- Player reset places them on the wave's current position using `clockRef`

**Wave math** (`getWaveHeight(x, z, t)` in App.tsx):
- CPU-side function shared between rendering and physics
- Cosine envelope: single hump centered at d=0, falls to zero at d=±(WAVE_WIDTH/2)
- Height = `WAVE_AMPLITUDE * cos(dNorm * PI/2)^1.5`

**Wave slope** (`getWaveSlope(x, z, t)` in App.tsx):
- Finite-difference gradient with EPSILON=0.05
- Returns `{ slopeX, slopeZ }` — used by speed physics, foil catch, and wave face lift

**Wave parameters:**
| Parameter | Value | Purpose |
|-----------|-------|---------|
| Amplitude | 3.5m | ~10-12ft wave face (big wave for testing) |
| Width | 14m | Total width perpendicular to crest |
| Angle | 30° (PI/6) | Diagonal orientation for right-hand wave |
| Speed | 3 m/s | Wave propagation speed |

**Starting position:**
| Parameter | Value | Purpose |
|-----------|-------|---------|
| START_WAVE_D | 2m | Distance from peak along wave direction |
| START_YAW | -WAVE_ANGLE | Face along the crest |

**WaveMesh component:**
- PlaneGeometry(1000, 1000, 200, 200) — 40K vertices
- Vertices deformed every frame via `useFrame` using `getWaveHeight` with time
- Normals recomputed each frame for correct lighting
- `meshStandardMaterial` with DoubleSide rendering

### Visual Setup
- **Board**: Orange box (0.5 x 0.05 x 1.5)
- **Mast**: Gray box below board (0.05 x 1.2 x 0.2)
- **Foil wings**: Two black boxes at mast base
- **Trail**: Blue glowing trail from rear stabilizer (40-unit length)
- **Scene**: Procedural Sky, 1000x1000 ocean with moving wave (WaveMesh component)
- **Lighting**: Ambient (0.5) + directional with shadows (1.5 intensity)

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
| Slope thrust coeff | 0.35 | Wave slope → speed |
| Foil catch coeff | 1.5 | Wave energy extraction |
| Wave face lift coeff | 0.2 | Extra lift on steep face |

### Suggested Next Steps
1. Add wave breaking/lip (whitewater at the crest)
2. Visual polish (custom shader, foam, spray particles)
3. Scoring system (trick detection)
4. Multiple wave types / wave sets

### What We Tried and Learned

1. **Starting orientation matters**: Player starts with `yaw = -WAVE_ANGLE` to ride along the wave crest. Incorrect yaw caused riding straight into the slope.

2. **Wave slope physics need careful tuning**: Previous attempt used coefficient 0.8 which overwhelmed pumping. Current 0.35 balances wave as primary speed source with pumping as supplement.

3. **Foil catch direction matters**: Direction-independent foil catch made going uphill feel like accelerating. Fixed by scaling to 50% when going uphill (`uphillRatio`).

4. **Camera angle affects controls perception**: Switching from chase cam to beach/drone view initially seemed to reverse controls, but the original roll values (A=0.55, D=-0.55) correctly map to bottom turn / snap given the wave geometry.

5. **Incremental approach is essential**: Adding features one at a time (visual wave → ride on wave → wave propagation → slope speed → foil catch → wave lift) made debugging much easier.

### Abandoned Files (Can Be Deleted or Reused)

These files were created during the first wave attempt and are NOT currently used by `App.tsx`:
- `src/types.ts` — shared TypeScript interfaces (GameState, WaveParams, WaveSample, PlayerState)
- `src/systems/waveFunction.ts` — `sampleWave()` with cosine envelope wave shape
- `src/components/Wave.tsx` — deformable wave mesh component
- `src/components/Player.tsx` — player with wave-adapted physics
- `src/components/Camera.tsx` — chase camera component (was also tried as side-on)
- `src/components/HUD.tsx` — extracted HUD component

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
│   ├── App.tsx                   # *** THE ENTIRE GAME (~382 lines) ***
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

1. **The physics feel good** — preserve them. Wave slope, foil catch, and pumping work together as a balanced speed system.

2. **Incremental changes only** — add one feature at a time and test.

3. **CPU-side wave math** — the wave height function must be callable from both the rendering code AND the physics code. Don't put wave deformation in a GPU shader only.

4. **No backend needed** — this is a pure client-side browser game. Ignore the express/sqlite/genai dependencies.

5. **Test with `npm run dev`** — Vite hot-reloads changes instantly at http://localhost:3000.

6. **Type-check with `npm run lint`** — runs `tsc --noEmit` to catch type errors without building.

7. **Player direction convention**: `yaw = 0` → faces -Z. `yaw = -WAVE_ANGLE` → rides along the crest.
