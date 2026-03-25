import { describe, expect, it } from 'vitest';
import { parsePuzzlePgn } from './pgn.js';
import { PuzzleSessionEngine } from './engine.js';
import type { PuzzleNode } from './types.js';

const SAMPLE_PGN = `[SetUp "1"]
[FEN "6n1/1P2k2r/3r1b2/R2p1b1p/pp2NP2/1n6/7R/7K w - - 4 63"]

63. Nxd6 Be4+ (Kxd6 64. b8=Q+) 64. Nxe4 Nxa5 65. b8=Q *`;

const SIMILAR_VARIATION_NODES: PuzzleNode[] = [
  {
    id: 1,
    parentId: null,
    ply: 0,
    san: '',
    uci: '',
    actor: 'opponent',
    isMainline: true,
    siblingOrder: 0,
    fenAfter: '8/8/8/8/8/8/8/8 w - - 0 1'
  },
  {
    id: 2,
    parentId: 1,
    ply: 1,
    san: 'Nf3',
    uci: 'g1f3',
    actor: 'user',
    isMainline: true,
    siblingOrder: 0,
    fenAfter: '8/8/8/8/8/8/8/8 b - - 0 1'
  },
  {
    id: 3,
    parentId: 2,
    ply: 2,
    san: '...e5',
    uci: 'e7e5',
    actor: 'opponent',
    isMainline: true,
    siblingOrder: 0,
    fenAfter: '8/8/8/8/8/8/8/8 w - - 0 1'
  },
  {
    id: 4,
    parentId: 3,
    ply: 3,
    san: 'Nxe5',
    uci: 'f3e5',
    actor: 'user',
    isMainline: true,
    siblingOrder: 0,
    fenAfter: '8/8/8/8/8/8/8/8 b - - 0 1'
  },
  {
    id: 5,
    parentId: 2,
    ply: 2,
    san: '...d5',
    uci: 'd7d5',
    actor: 'opponent',
    isMainline: false,
    siblingOrder: 1,
    fenAfter: '8/8/8/8/8/8/8/8 w - - 0 1'
  },
  {
    id: 6,
    parentId: 5,
    ply: 3,
    san: 'Nxe5',
    uci: 'f3e5',
    actor: 'user',
    isMainline: false,
    siblingOrder: 0,
    fenAfter: '8/8/8/8/8/8/8/8 b - - 0 1'
  },
  {
    id: 7,
    parentId: 2,
    ply: 2,
    san: '...c5',
    uci: 'c7c5',
    actor: 'opponent',
    isMainline: false,
    siblingOrder: 2,
    fenAfter: '8/8/8/8/8/8/8/8 w - - 0 1'
  },
  {
    id: 8,
    parentId: 7,
    ply: 3,
    san: 'd4',
    uci: 'd2d4',
    actor: 'user',
    isMainline: false,
    siblingOrder: 0,
    fenAfter: '8/8/8/8/8/8/8/8 b - - 0 1'
  }
];

const ALL_SIMILAR_VARIATION_NODES: PuzzleNode[] = SIMILAR_VARIATION_NODES.filter((node) => node.id !== 7 && node.id !== 8);

describe('PuzzleSessionEngine', () => {
  it('parses variations and explores all opponent branches', () => {
    const parsed = parsePuzzlePgn(SAMPLE_PGN, 'test');
    const engine = new PuzzleSessionEngine({
      nodes: parsed.nodes,
      rootNodeId: parsed.rootNode.id,
      mode: 'explore'
    });

    expect(engine.totalLines).toBe(2);

    let cursor = engine.getInitialCursor();

    const firstMove = engine.playUserMove(cursor, 'e4d6');
    expect(firstMove.result).toBe('correct');
    expect(firstMove.autoPlayedMoves[0]).toBe('f5e4');

    cursor = firstMove.cursor;
    const secondMove = engine.playUserMove(cursor, 'd6e4');
    expect(secondMove.result).toBe('correct');
    expect(secondMove.autoPlayedMoves[0]).toBe('b3a5');

    cursor = secondMove.cursor;
    const finalMainline = engine.playUserMove(cursor, 'b7b8q');
    expect(finalMainline.result).toBe('correct');
    expect(finalMainline.snapshot.lineIndex).toBe(1);

    cursor = finalMainline.cursor;
    const variationFinish = engine.playUserMove(cursor, 'b7b8q');
    expect(variationFinish.result).toBe('completed');
  });

  it('rejects incorrect user moves', () => {
    const parsed = parsePuzzlePgn(SAMPLE_PGN, 'test');
    const engine = new PuzzleSessionEngine({
      nodes: parsed.nodes,
      rootNodeId: parsed.rootNode.id,
      mode: 'explore'
    });

    const cursor = engine.getInitialCursor();
    const result = engine.playUserMove(cursor, 'e4f6');

    expect(result.result).toBe('incorrect');
    expect(result.expectedBestMoveUci).toBe('e4d6');
  });

  it('keeps repetitive branches when similar-variation skipping is disabled', () => {
    const engine = new PuzzleSessionEngine({
      nodes: SIMILAR_VARIATION_NODES,
      rootNodeId: 1,
      mode: 'explore'
    });

    let cursor = engine.getInitialCursor();
    const opener = engine.playUserMove(cursor, 'g1f3');
    cursor = opener.cursor;

    const repeated = engine.playUserMove(cursor, 'f3e5');
    expect(repeated.skippedSimilarVariations).toBe(0);
    expect(repeated.snapshot.lineIndex).toBe(1);
    expect(engine.hint(repeated.cursor).bestMoveUci).toBe('f3e5');
  });

  it('auto-skips consecutive similar branches when enabled', () => {
    const engine = new PuzzleSessionEngine({
      nodes: SIMILAR_VARIATION_NODES,
      rootNodeId: 1,
      mode: 'explore'
    });

    let cursor = engine.getInitialCursor();
    const opener = engine.playUserMove(cursor, 'g1f3', { skipSimilarVariations: true });
    cursor = opener.cursor;

    const distinct = engine.playUserMove(cursor, 'f3e5', { skipSimilarVariations: true });
    expect(distinct.skippedSimilarVariations).toBe(1);
    expect(distinct.snapshot.lineIndex).toBe(2);
    expect(engine.hint(distinct.cursor).bestMoveUci).toBe('d2d4');
  });

  it('marks the puzzle complete when all remaining branches are similar', () => {
    const engine = new PuzzleSessionEngine({
      nodes: ALL_SIMILAR_VARIATION_NODES,
      rootNodeId: 1,
      mode: 'explore'
    });

    let cursor = engine.getInitialCursor();
    const opener = engine.playUserMove(cursor, 'g1f3', { skipSimilarVariations: true });
    cursor = opener.cursor;

    const completed = engine.playUserMove(cursor, 'f3e5', { skipSimilarVariations: true });
    expect(completed.result).toBe('completed');
    expect(completed.skippedSimilarVariations).toBe(1);
    expect(completed.snapshot.completedBranches).toBe(completed.snapshot.totalLines);
  });

  it('chains explicit variation skips across similar branches when enabled', () => {
    const engine = new PuzzleSessionEngine({
      nodes: SIMILAR_VARIATION_NODES,
      rootNodeId: 1,
      mode: 'explore'
    });

    const opener = engine.playUserMove(engine.getInitialCursor(), 'g1f3', { skipSimilarVariations: true });
    const skipped = engine.skipVariation(opener.cursor, { skipSimilarVariations: true });

    expect(skipped.skipped).toBe(true);
    expect(skipped.skippedSimilarVariations).toBe(1);
    expect(skipped.snapshot.lineIndex).toBe(2);
    expect(engine.hint(skipped.cursor).bestMoveUci).toBe('d2d4');
  });
});
