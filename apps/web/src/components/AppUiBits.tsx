import { createElement, type AnimationEvent as ReactAnimationEvent } from 'react';
import type { FallingCapturePiece } from '../lib/appShared.js';
import type { FrontendI18n, PromotionPieceCode } from '../lib/i18n.js';

export type TransportControlVariant = 'skip-back' | 'back' | 'forward' | 'skip-forward';

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

export function TransportControlIcon(props: { variant: TransportControlVariant }) {
  const { variant } = props;

  switch (variant) {
    case 'skip-back':
      return (
        <svg className="transport-control-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <rect x="2.4" y="5" width="2.3" height="14" rx="0.75" />
          <path d="M11.3 6.2 5.7 12l5.6 5.8V6.2Z" />
          <path d="M18.8 6.2 13.2 12l5.6 5.8V6.2Z" />
        </svg>
      );
    case 'back':
      return (
        <svg className="transport-control-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <rect x="3.8" y="5" width="2.3" height="14" rx="0.75" />
          <path d="M18.2 6.1 9.2 12l9 5.9V6.1Z" />
        </svg>
      );
    case 'forward':
      return (
        <svg className="transport-control-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M5.8 6.1 14.8 12l-9 5.9V6.1Z" />
          <rect x="17.9" y="5" width="2.3" height="14" rx="0.75" />
        </svg>
      );
    case 'skip-forward':
      return (
        <svg className="transport-control-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M5.2 6.2 10.8 12l-5.6 5.8V6.2Z" />
          <path d="M12.7 6.2 18.3 12l-5.6 5.8V6.2Z" />
          <rect x="19.3" y="5" width="2.3" height="14" rx="0.75" />
        </svg>
      );
  }
}

export function PuzzleActionButtons(props: {
  disabled: boolean;
  isReviewMode: boolean;
  hintsEnabled: boolean;
  canHint: boolean;
  canReveal: boolean;
  i18n: FrontendI18n;
  onHint: () => void;
  onReveal: () => void;
  onRestartPuzzle: () => void;
}) {
  const { disabled, isReviewMode, hintsEnabled, canHint, canReveal, i18n, onHint, onReveal, onRestartPuzzle } = props;

  return (
    <>
      <button
        type="button"
        className="btn-secondary"
        disabled={disabled || isReviewMode || !hintsEnabled || !canHint}
        onClick={onHint}
      >
        {i18n.hint}
      </button>
      <button type="button" className="btn-secondary" disabled={disabled || isReviewMode || !canReveal} onClick={onReveal}>
        {i18n.showSolution}
      </button>
      <button type="button" className="btn-primary" disabled={disabled || isReviewMode} onClick={onRestartPuzzle}>
        {i18n.restartPuzzle}
      </button>
    </>
  );
}

export function PuzzleTransportButtons(props: {
  disabled: boolean;
  canGoPrevious: boolean;
  canGoNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const { disabled, canGoPrevious, canGoNext, onPrevious, onNext } = props;

  return (
    <>
      <button
        type="button"
        className="btn-secondary transport-control-button"
        disabled={disabled || !canGoPrevious}
        onClick={onPrevious}
        aria-label="Previous puzzle"
        title="Previous puzzle"
      >
        <TransportControlIcon variant="skip-back" />
      </button>
      <button
        type="button"
        className="btn-secondary transport-control-button"
        disabled={disabled || !canGoNext}
        onClick={onNext}
        aria-label="Next puzzle"
        title="Next puzzle"
      >
        <TransportControlIcon variant="skip-forward" />
      </button>
    </>
  );
}

export function ReviewNavigationButtons(props: {
  disabled: boolean;
  canGoBackward: boolean;
  canGoForward: boolean;
  secondary?: boolean;
  i18n: FrontendI18n;
  onBackOne: () => void;
  onForwardOne: () => void;
}) {
  const { disabled, canGoBackward, canGoForward, secondary = false, i18n, onBackOne, onForwardOne } = props;
  const iconButtonClassName = secondary ? 'btn-secondary transport-control-button' : 'transport-control-button';

  return (
    <>
      <button
        type="button"
        className={iconButtonClassName}
        disabled={disabled || !canGoBackward}
        onClick={onBackOne}
        aria-label={i18n.backOneMove}
        title={i18n.backOneMove}
      >
        <TransportControlIcon variant="back" />
      </button>
      <button
        type="button"
        className={iconButtonClassName}
        disabled={disabled || !canGoForward}
        onClick={onForwardOne}
        aria-label="Forward one move"
        title="Forward one move"
      >
        <TransportControlIcon variant="forward" />
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
