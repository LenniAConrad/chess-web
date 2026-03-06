import { Chess } from 'chess.js';
import { parseGame } from '@mliebelt/pgn-parser';
import type { MoveActor, ParsedPuzzle, PuzzleNode } from './types.js';

const DEFAULT_START_FEN = new Chess().fen();

interface ParsedMove {
  notation: {
    notation: string;
  };
  turn: 'w' | 'b';
  variations: ParsedMove[][];
}

interface ParsedGame {
  tags?: Record<string, unknown>;
  moves: ParsedMove[];
}

function sideToMove(fen: string): 'w' | 'b' {
  return (fen.split(' ')[1] === 'b' ? 'b' : 'w') as 'w' | 'b';
}

function oppositeActor(actor: MoveActor): MoveActor {
  return actor === 'user' ? 'opponent' : 'user';
}

function makeUci(from: string, to: string, promotion?: string): string {
  if (!promotion) {
    return `${from}${to}`;
  }
  return `${from}${to}${promotion.toLowerCase()}`;
}

export function parsePuzzlePgn(pgnText: string, source = 'import'): ParsedPuzzle {
  const game = parseGame(pgnText) as unknown as ParsedGame;
  if (!game || !Array.isArray(game.moves) || game.moves.length === 0) {
    throw new Error('PGN did not contain any moves');
  }

  const startFen = typeof game.tags?.FEN === 'string' ? game.tags.FEN : DEFAULT_START_FEN;
  const title = typeof game.tags?.Event === 'string' ? game.tags.Event : 'Untitled Puzzle';

  const userSide = sideToMove(startFen);
  const userActor: MoveActor = 'user';

  const rootNode: PuzzleNode = {
    id: 1,
    parentId: null,
    ply: 0,
    san: '',
    uci: '',
    actor: oppositeActor(userActor),
    isMainline: true,
    siblingOrder: 0,
    fenAfter: startFen
  };

  const nodes: PuzzleNode[] = [rootNode];
  let nextId = 2;
  const siblingCounters = new Map<number, number>();

  function nextSiblingOrder(parentId: number): number {
    const current = siblingCounters.get(parentId) ?? 0;
    siblingCounters.set(parentId, current + 1);
    return current;
  }

  function actorFromTurn(turn: 'w' | 'b'): MoveActor {
    return turn === userSide ? 'user' : 'opponent';
  }

  function processLine(
    moves: ParsedMove[],
    parentId: number,
    startPly: number,
    chess: Chess,
    isMainlinePath: boolean
  ): void {
    let currentParentId = parentId;
    let currentPly = startPly;

    for (const move of moves) {
      const beforeFen = chess.fen();
      const san = move.notation.notation;
      const playedMove = chess.move(san);
      if (!playedMove) {
        throw new Error(`Illegal move in PGN: ${san}`);
      }

      currentPly += 1;
      const node: PuzzleNode = {
        id: nextId++,
        parentId: currentParentId,
        ply: currentPly,
        san: playedMove.san,
        uci: makeUci(playedMove.from, playedMove.to, playedMove.promotion),
        actor: actorFromTurn(move.turn),
        isMainline: isMainlinePath,
        siblingOrder: nextSiblingOrder(currentParentId),
        fenAfter: chess.fen()
      };
      nodes.push(node);

      for (const variation of move.variations ?? []) {
        const variationChess = new Chess(beforeFen);
        processLine(variation, currentParentId, currentPly - 1, variationChess, false);
      }

      currentParentId = node.id;
    }
  }

  processLine(game.moves, rootNode.id, 0, new Chess(startFen), true);

  return {
    title,
    source,
    startFen,
    rootNode,
    nodes
  };
}
