import { expect, it, describe } from 'vitest';
import { Chess } from 'chess.js';
import { applyUciMove, getCapturedPieceSkin, getFenAfterUciMove, getMoveSoundDecision } from './appShared.js';

describe('appShared move helpers', () => {
  const fen = '8/8/8/8/8/8/8/K6k w - - 0 1';

  it('treats invalid UCI moves as a no-op', () => {
    const chess = new Chess(fen);

    expect(applyUciMove(chess, 'b5b6')).toBe(false);
    expect(chess.fen()).toBe(fen);
    expect(getFenAfterUciMove(fen, 'b5b6')).toBeNull();
  });

  it('does not throw when move metadata is requested for an invalid move', () => {
    expect(getMoveSoundDecision(fen, 'b5b6')).toEqual({
      primary: null,
      isCheck: false
    });

    expect(getCapturedPieceSkin(fen, 'b5b6')).toBeNull();
  });
});
