import type { GameState } from '../types';

interface HUDProps {
  gameState: GameState;
}

export default function HUD({ gameState }: HUDProps) {
  if (gameState !== 'playing') return null;

  return (
    <div className="absolute top-4 right-4 bg-slate-900/80 text-white p-4 rounded-xl shadow-md pointer-events-none font-mono min-w-[150px]">
      <div className="flex justify-between mb-1">
        <span className="text-slate-400">Speed:</span>
        <span><span id="hud-speed">8.0</span> m/s</span>
      </div>
      <div className="flex justify-between">
        <span className="text-slate-400">Height:</span>
        <span><span id="hud-height">0.40</span> m</span>
      </div>
    </div>
  );
}
