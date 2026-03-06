import { describe, expect, it } from 'vitest';
import { parsePuzzlePgn } from './pgn.js';
import { PuzzleSessionEngine } from './engine.js';

const SAMPLE_PGN = `[SetUp "1"]
[FEN "6n1/1P2k2r/3r1b2/R2p1b1p/pp2NP2/1n6/7R/7K w - - 4 63"]

63. Nxd6 Be4+ (Kxd6 64. b8=Q+) 64. Nxe4 Nxa5 65. b8=Q *`;

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
});
