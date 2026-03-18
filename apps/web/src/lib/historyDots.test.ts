import { describe, expect, it } from 'vitest';
import type { SessionHistoryItem } from '../types/api.js';
import { getHistoryDotLabel, getHistoryDotSymbol, getHistoryDotTone } from './historyDots.js';

function createHistoryItem(input: Partial<SessionHistoryItem>): SessionHistoryItem {
  return {
    sessionId: input.sessionId ?? 's1',
    puzzlePublicId: input.puzzlePublicId ?? 'pz-1',
    puzzleTitle: input.puzzleTitle ?? 'Puzzle',
    createdAt: input.createdAt ?? '2026-03-10T00:00:00.000Z',
    status: input.status ?? 'incorrect',
    autoplayUsed: input.autoplayUsed ?? false,
    wrongMoveCount: input.wrongMoveCount ?? 0,
    hintCount: input.hintCount ?? 0,
    solved: input.solved ?? false,
    revealed: input.revealed ?? false
  };
}

describe('history dot classification', () => {
  it('maps autoplay sessions to blue', () => {
    expect(
      getHistoryDotTone(
        createHistoryItem({
          autoplayUsed: true,
          solved: true,
          wrongMoveCount: 2,
          hintCount: 1
        })
      )
    ).toBe('blue');
  });

  it('maps solved sessions to green/yellow/orange', () => {
    expect(
      getHistoryDotTone(
        createHistoryItem({
          solved: true,
          wrongMoveCount: 0,
          hintCount: 0
        })
      )
    ).toBe('green');

    expect(
      getHistoryDotTone(
        createHistoryItem({
          solved: true,
          wrongMoveCount: 0,
          hintCount: 2
        })
      )
    ).toBe('yellow');

    expect(
      getHistoryDotTone(
        createHistoryItem({
          solved: true,
          wrongMoveCount: 1,
          hintCount: 0
        })
      )
    ).toBe('orange');
  });

  it('maps unsolved sessions to gray/red', () => {
    expect(
      getHistoryDotTone(
        createHistoryItem({
          solved: false,
          wrongMoveCount: 0,
          hintCount: 0,
          revealed: false,
          autoplayUsed: false
        })
      )
    ).toBe('gray');

    expect(
      getHistoryDotTone(
        createHistoryItem({
          solved: false,
          wrongMoveCount: 1,
          hintCount: 0
        })
      )
    ).toBe('red');

    expect(
      getHistoryDotTone(
        createHistoryItem({
          solved: false,
          wrongMoveCount: 0,
          hintCount: 2
        })
      )
    ).toBe('red');
  });

  it('returns symbols and labels', () => {
    expect(getHistoryDotSymbol('blue')).toBe('A');
    expect(getHistoryDotSymbol('green')).toBe('\u2713');
    expect(getHistoryDotSymbol('yellow')).toBe('\u2713');
    expect(getHistoryDotSymbol('orange')).toBe('\u2713');
    expect(getHistoryDotSymbol('red')).toBe('\u2715');
    expect(getHistoryDotSymbol('gray')).toBe('\u2013');

    expect(getHistoryDotLabel('blue')).toBe('Autoplay');
    expect(getHistoryDotLabel('green')).toBe('Solved clean');
    expect(getHistoryDotLabel('yellow')).toBe('Solved with hints');
    expect(getHistoryDotLabel('orange')).toBe('Solved with errors');
    expect(getHistoryDotLabel('red')).toBe('Failed');
    expect(getHistoryDotLabel('gray')).toBe('Not played');
  });
});
