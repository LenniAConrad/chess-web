import { createElement, type AnimationEvent as ReactAnimationEvent } from 'react';
import type { FallingCapturePiece } from '../lib/appShared.js';
import type { FrontendI18n, PromotionPieceCode } from '../lib/i18n.js';

export function LoadingScreen(props: { i18n: FrontendI18n; errorText: string | null; pieceSrc: string }) {
  const { i18n, errorText, pieceSrc } = props;

  return (
    <>
      <main className="loading-minimal">
        <div className="loading-piece-shell" aria-hidden="true">
          <span className="loading-piece-glow" />
          <img className="loading-piece" src={pieceSrc} alt="" />
        </div>
        <h1>chess-web</h1>
        <p className="loading-status">{i18n.loading}</p>
      </main>
      {errorText ? (
        <p className="global-error-toast" role="alert" aria-live="assertive">
          {errorText}
        </p>
      ) : null}
    </>
  );
}

export function PuzzleActionButtons(props: {
  disabled: boolean;
  isReviewMode: boolean;
  hintsEnabled: boolean;
  puzzleIsComplete: boolean;
  i18n: FrontendI18n;
  onHint: () => void;
  onReveal: () => void;
  onRestartPuzzle: () => void;
  onSkipVariation: () => void;
  onNextPuzzle: () => void;
}) {
  const {
    disabled,
    isReviewMode,
    hintsEnabled,
    puzzleIsComplete,
    i18n,
    onHint,
    onReveal,
    onRestartPuzzle,
    onSkipVariation,
    onNextPuzzle
  } = props;

  return (
    <>
      <button type="button" className="btn-secondary" disabled={disabled || isReviewMode || !hintsEnabled} onClick={onHint}>
        {i18n.hint}
      </button>
      <button type="button" className="btn-secondary" disabled={disabled || isReviewMode} onClick={onReveal}>
        {i18n.showSolution}
      </button>
      {puzzleIsComplete ? (
        <button type="button" className="btn-secondary" disabled={disabled || isReviewMode} onClick={onRestartPuzzle}>
          {i18n.restartPuzzle}
        </button>
      ) : (
        <button type="button" className="btn-secondary" disabled={disabled || isReviewMode} onClick={onSkipVariation}>
          {i18n.skipVariation}
        </button>
      )}
      <button type="button" className="btn-primary" disabled={disabled} onClick={onNextPuzzle}>
        {i18n.nextPuzzle}
      </button>
    </>
  );
}

export function ReviewNavigationButtons(props: {
  disabled: boolean;
  isReviewMode: boolean;
  secondary?: boolean;
  i18n: FrontendI18n;
  onBackOne: () => void;
  onBackToLive: () => void;
}) {
  const { disabled, isReviewMode, secondary = false, i18n, onBackOne, onBackToLive } = props;
  const className = secondary ? 'btn-secondary' : undefined;

  return (
    <>
      <button type="button" className={className} disabled={disabled || !isReviewMode} onClick={onBackOne}>
        {i18n.backOneMove}
      </button>
      <button type="button" className={className} disabled={disabled || !isReviewMode} onClick={onBackToLive}>
        {i18n.backToLivePuzzle}
      </button>
    </>
  );
}

export function ZenExitHint(props: { visible: boolean; label: string; onExit: () => void }) {
  const { visible, label, onExit } = props;

  if (!visible) {
    return null;
  }

  return (
    <button type="button" className="zen-exit-hint" onClick={onExit}>
      {label}
    </button>
  );
}

export function CaptureRainLayer(props: {
  pieces: FallingCapturePiece[];
  onPieceAnimationEnd: (event: ReactAnimationEvent<HTMLDivElement>, pieceId: number) => void;
}) {
  const { pieces, onPieceAnimationEnd } = props;

  return (
    <div className="capture-rain-layer" aria-hidden="true">
      {pieces.map((piece) => (
        <div
          key={piece.id}
          className="capture-rain-piece"
          style={piece.style}
          onAnimationEnd={(event) => onPieceAnimationEnd(event, piece.id)}
        >
          <div className="capture-rain-piece-skin cg-wrap">
            {createElement('piece', {
              className: `capture-rain-piece-spin ${piece.role} ${piece.color}`
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export function getPromotionPieceLabels(i18n: FrontendI18n): Record<PromotionPieceCode, string> {
  return {
    q: i18n.promoteTo(i18n.promotionPieceNames.q),
    r: i18n.promoteTo(i18n.promotionPieceNames.r),
    b: i18n.promoteTo(i18n.promotionPieceNames.b),
    n: i18n.promoteTo(i18n.promotionPieceNames.n)
  };
}
