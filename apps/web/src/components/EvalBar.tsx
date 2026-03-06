import type { CSSProperties } from 'react';

interface EvalBarProps {
  cp: number | null;
  mate: number | null;
  depth: number;
  error: string | null;
  orientation: 'white' | 'black';
}

const GUIDE_CP_LEVELS = [600, 300, 0, -300, -600];

function normalizeScore(cp: number | null, mate: number | null): number {
  if (mate !== null) {
    return mate > 0 ? 1 : 0;
  }

  if (cp === null) {
    return 0.5;
  }

  const clamped = Math.max(-800, Math.min(800, cp));
  return (clamped + 800) / 1600;
}

export function EvalBar({ cp, mate, depth, error, orientation }: EvalBarProps) {
  const value = normalizeScore(cp, mate);
  const fillPercent = value * 100;
  const fillStyle = { '--eval-fill': `${fillPercent}%` } as CSSProperties;
  const barClassName = `eval-bar${orientation === 'black' ? ' is-flipped' : ''}`;

  return (
    <div className="eval-wrap">
      <div className={barClassName}>
        <div className="eval-fill" style={fillStyle} />
        <div className="eval-guides" aria-hidden="true">
          {GUIDE_CP_LEVELS.map((cpLevel) => {
            const position = normalizeScore(cpLevel, null);
            const style = {
              '--guide-top': `${(1 - position) * 100}%`,
              '--guide-left': `${position * 100}%`
            } as CSSProperties;

            return <span key={cpLevel} className={`eval-guide-line${cpLevel === 0 ? ' is-even' : ''}`} style={style} />;
          })}
        </div>
      </div>
      <div className="eval-meta">
        <div>{error ? 'Engine unavailable' : mate !== null ? `M${mate}` : cp !== null ? (cp / 100).toFixed(2) : '--'}</div>
        <div className="eval-depth">d{depth}</div>
      </div>
    </div>
  );
}
