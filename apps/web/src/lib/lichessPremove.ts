import { Chess, type Square } from 'chess.js';
import type { Key } from 'chessground/types';

type Color = 'white' | 'black';
type Role = 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king';

type Pos = [number, number];
type Pieces = Map<Key, Piece>;

type Mobility = (ctx: MobilityContext) => boolean;

interface Piece {
  role: Role;
  color: Color;
}

interface MobilityContext {
  color: Color;
  role: Role;
  orig: { key: Key; pos: Pos };
  dest: { key: Key; pos: Pos };
  friendlies: Pieces;
  enemies: Pieces;
  allPieces: Pieces;
  lastMove?: [Key, Key];
  rookFilesFriendlies: number[];
}

const FILES = 'abcdefgh';
const RANKS = '12345678';
const ALL_KEYS: Key[] = (() => {
  const keys: Key[] = [];
  for (const file of FILES) {
    for (const rank of RANKS) {
      keys.push(`${file}${rank}` as Key);
    }
  }
  return keys;
})();

const ROLE_FROM_TYPE: Record<string, Role> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king'
};

function diff(a: number, b: number): number {
  return Math.abs(a - b);
}

function key2pos(key: Key): Pos {
  return [key.charCodeAt(0) - 97, Number(key[1]) - 1];
}

function pos2key(pos: Pos): Key | undefined {
  const [file, rank] = pos;
  if (file < 0 || file > 7 || rank < 0 || rank > 7) {
    return undefined;
  }
  return `${FILES[file]}${rank + 1}` as Key;
}

function adjacentSquares(square: Key): Key[] {
  const [x, y] = key2pos(square);
  const squares: Key[] = [];

  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      const shifted = pos2key([x + dx, y + dy]);
      if (shifted) {
        squares.push(shifted);
      }
    }
  }

  return squares;
}

function squareShiftedVertically(square: Key, delta: number): Key | undefined {
  const [x, y] = key2pos(square);
  return pos2key([x, y + delta]);
}

function squaresBetween(x1: number, y1: number, x2: number, y2: number): Key[] {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);

  if (!(dx === 0 || dy === 0 || absX === absY)) {
    return [];
  }

  const stepX = dx === 0 ? 0 : dx / absX;
  const stepY = dy === 0 ? 0 : dy / absY;
  const squares: Key[] = [];

  let x = x1 + stepX;
  let y = y1 + stepY;
  while (x !== x2 || y !== y2) {
    const square = pos2key([x, y]);
    if (square) {
      squares.push(square);
    }
    x += stepX;
    y += stepY;
  }

  // Exclude destination.
  return squares.slice(0, -1);
}

function pawnDirAdvance(x1: number, y1: number, x2: number, y2: number, isWhite: boolean): boolean {
  if (x1 !== x2) {
    return false;
  }

  return isWhite
    ? y2 === y1 + 1 || (y1 <= 1 && y2 === y1 + 2)
    : y2 === y1 - 1 || (y1 >= 6 && y2 === y1 - 2);
}

function pawnDirCapture(x1: number, y1: number, x2: number, y2: number, isWhite: boolean): boolean {
  return Math.abs(x2 - x1) === 1 && y2 === y1 + (isWhite ? 1 : -1);
}

function knightDir(x1: number, y1: number, x2: number, y2: number): boolean {
  const xd = diff(x1, x2);
  const yd = diff(y1, y2);
  return (xd === 1 && yd === 2) || (xd === 2 && yd === 1);
}

function bishopDir(x1: number, y1: number, x2: number, y2: number): boolean {
  return diff(x1, x2) === diff(y1, y2);
}

function rookDir(x1: number, y1: number, x2: number, y2: number): boolean {
  return x1 === x2 || y1 === y2;
}

function queenDir(x1: number, y1: number, x2: number, y2: number): boolean {
  return bishopDir(x1, y1, x2, y2) || rookDir(x1, y1, x2, y2);
}

function kingDirNonCastling(x1: number, y1: number, x2: number, y2: number): boolean {
  return diff(x1, x2) < 2 && diff(y1, y2) < 2;
}

function parsePieces(fen: string): Pieces {
  const chess = new Chess(fen);
  const pieces: Pieces = new Map();

  for (const file of FILES) {
    for (const rank of RANKS) {
      const square = `${file}${rank}` as Square;
      const piece = chess.get(square);
      if (!piece) {
        continue;
      }
      const role = ROLE_FROM_TYPE[piece.type];
      if (!role) {
        continue;
      }

      pieces.set(`${file}${rank}` as Key, {
        role,
        color: piece.color === 'w' ? 'white' : 'black'
      });
    }
  }

  return pieces;
}

function partitionPiecesByColor(pieces: Pieces, color: Color): { friendlies: Pieces; enemies: Pieces } {
  const friendlies: Pieces = new Map();
  const enemies: Pieces = new Map();

  for (const [square, piece] of pieces) {
    if (piece.color === color) {
      friendlies.set(square, piece);
    } else {
      enemies.set(square, piece);
    }
  }

  return { friendlies, enemies };
}

function rookFilesOf(pieces: Pieces, color: Color): number[] {
  const backrank = color === 'white' ? '1' : '8';
  const files: number[] = [];

  for (const [square, piece] of pieces) {
    if (piece.role === 'rook' && piece.color === color && square[1] === backrank) {
      files.push(key2pos(square)[0]);
    }
  }

  return files;
}

class LichessStylePremove {
  private isDestOccupiedByFriendly = (ctx: MobilityContext): boolean => ctx.friendlies.has(ctx.dest.key);

  private isDestOccupiedByEnemy = (ctx: MobilityContext): boolean => ctx.enemies.has(ctx.dest.key);

  private anyPieceBetween = (orig: Pos, dest: Pos, pieces: Pieces): boolean =>
    squaresBetween(orig[0], orig[1], dest[0], dest[1]).some((square) => pieces.has(square));

  private canEnemyPawnAdvanceToSquare = (pawnStart: Key, dest: Key, ctx: MobilityContext): boolean => {
    const piece = ctx.enemies.get(pawnStart);
    if (piece?.role !== 'pawn') {
      return false;
    }

    const step = piece.color === 'white' ? 1 : -1;
    const startPos = key2pos(pawnStart);
    const destPos = key2pos(dest);

    return (
      pawnDirAdvance(startPos[0], startPos[1], destPos[0], destPos[1], piece.color === 'white') &&
      !this.anyPieceBetween(startPos, [destPos[0], destPos[1] + step], ctx.allPieces)
    );
  };

  private canEnemyPawnCaptureOnSquare = (pawnStart: Key, dest: Key, ctx: MobilityContext): boolean => {
    const enemyPawn = ctx.enemies.get(pawnStart);
    return (
      enemyPawn?.role === 'pawn' &&
      pawnDirCapture(...key2pos(pawnStart), ...key2pos(dest), enemyPawn.color === 'white') &&
      (ctx.friendlies.has(dest) ||
        this.canBeCapturedBySomeEnemyEnPassant(
          squareShiftedVertically(dest, enemyPawn.color === 'white' ? -1 : 1),
          ctx.friendlies,
          ctx.enemies,
          ctx.lastMove
        ))
    );
  };

  private canSomeEnemyPawnAdvanceToDest = (ctx: MobilityContext): boolean =>
    [...ctx.enemies.keys()].some((key) => this.canEnemyPawnAdvanceToSquare(key, ctx.dest.key, ctx));

  private isDestControlledByEnemy = (ctx: MobilityContext, excludeRoles?: Role[]): boolean => {
    const target = ctx.dest.pos;

    return [...ctx.enemies].some(([key, piece]) => {
      const piecePos = key2pos(key);
      const attacks =
        !excludeRoles?.includes(piece.role) &&
        ((piece.role === 'pawn' && pawnDirCapture(...piecePos, ...target, piece.color === 'white')) ||
          (piece.role === 'knight' && knightDir(...piecePos, ...target)) ||
          (piece.role === 'bishop' && bishopDir(...piecePos, ...target)) ||
          (piece.role === 'rook' && rookDir(...piecePos, ...target)) ||
          (piece.role === 'queen' && queenDir(...piecePos, ...target)) ||
          (piece.role === 'king' && kingDirNonCastling(...piecePos, ...target)));

      if (!attacks) {
        return false;
      }

      if (piece.role === 'bishop' || piece.role === 'rook' || piece.role === 'queen') {
        return !this.anyPieceBetween(piecePos, target, ctx.allPieces);
      }

      return true;
    });
  };

  private isFriendlyOnDestAndAttacked = (ctx: MobilityContext): boolean =>
    this.isDestOccupiedByFriendly(ctx) &&
    (this.canBeCapturedBySomeEnemyEnPassant(ctx.dest.key, ctx.friendlies, ctx.enemies, ctx.lastMove) ||
      this.isDestControlledByEnemy(ctx));

  private canBeCapturedBySomeEnemyEnPassant = (
    potentialSquareOfFriendlyPawn: Key | undefined,
    friendlies: Pieces,
    enemies: Pieces,
    lastMove?: [Key, Key]
  ): boolean => {
    if (!potentialSquareOfFriendlyPawn || (lastMove && potentialSquareOfFriendlyPawn !== lastMove[1])) {
      return false;
    }

    const pos = key2pos(potentialSquareOfFriendlyPawn);
    const friendly = friendlies.get(potentialSquareOfFriendlyPawn);

    return (
      friendly?.role === 'pawn' &&
      pos[1] === (friendly.color === 'white' ? 3 : 4) &&
      (!lastMove || diff(key2pos(lastMove[0])[1], pos[1]) === 2) &&
      [1, -1].some((delta) => {
        const square = pos2key([pos[0] + delta, pos[1]]);
        return Boolean(square && enemies.get(square)?.role === 'pawn');
      })
    );
  };

  private isPathClearEnoughOfFriendliesForPremove = (ctx: MobilityContext, isPawnAdvance: boolean): boolean => {
    const between = squaresBetween(...ctx.orig.pos, ...ctx.dest.pos);
    if (isPawnAdvance) {
      between.push(ctx.dest.key);
    }

    const friendliesBetween = between.filter((square) => ctx.friendlies.has(square));
    if (friendliesBetween.length === 0) {
      return true;
    }

    const firstFriendly = friendliesBetween[0];
    if (!firstFriendly) {
      return true;
    }
    const nextSquare = squareShiftedVertically(firstFriendly, ctx.color === 'white' ? -1 : 1);

    return (
      friendliesBetween.length === 1 &&
      this.canBeCapturedBySomeEnemyEnPassant(firstFriendly, ctx.friendlies, ctx.enemies, ctx.lastMove) &&
      Boolean(nextSquare) &&
      !between.includes(nextSquare as Key)
    );
  };

  private isPathClearEnoughOfEnemiesForPremove = (ctx: MobilityContext, isPawnAdvance: boolean): boolean => {
    const between = squaresBetween(...ctx.orig.pos, ...ctx.dest.pos);
    if (isPawnAdvance) {
      between.push(ctx.dest.key);
    }

    const enemiesBetween = between.filter((square) => ctx.enemies.has(square));
    if (enemiesBetween.length > 1) {
      return false;
    }
    if (enemiesBetween.length === 0) {
      return true;
    }

    const enemySquare = enemiesBetween[0];
    if (!enemySquare) {
      return true;
    }
    const enemy = ctx.enemies.get(enemySquare);
    if (!enemy || enemy.role !== 'pawn') {
      return true;
    }

    const enemyStep = enemy.color === 'white' ? 1 : -1;
    const squareAbove = squareShiftedVertically(enemySquare, enemyStep);

    const enemyPawnDests: Key[] = squareAbove
      ? [
          ...adjacentSquares(squareAbove).filter((square) => this.canEnemyPawnCaptureOnSquare(enemySquare, square, ctx)),
          ...[squareAbove, squareShiftedVertically(squareAbove, enemyStep)]
            .filter((square): square is Key => Boolean(square))
            .filter((square) => this.canEnemyPawnAdvanceToSquare(enemySquare, square, ctx))
        ]
      : [];

    const badSquares = [...between, ctx.orig.key];
    return enemyPawnDests.some((square) => !badSquares.includes(square));
  };

  private isPathClearEnoughForPremove = (ctx: MobilityContext, isPawnAdvance: boolean): boolean =>
    this.isPathClearEnoughOfFriendliesForPremove(ctx, isPawnAdvance) &&
    this.isPathClearEnoughOfEnemiesForPremove(ctx, isPawnAdvance);

  private pawn: Mobility = (ctx: MobilityContext): boolean => {
    const step = ctx.color === 'white' ? 1 : -1;

    if (diff(ctx.orig.pos[0], ctx.dest.pos[0]) > 1) {
      return false;
    }

    if (ctx.orig.pos[0] === ctx.dest.pos[0]) {
      return (
        pawnDirAdvance(...ctx.orig.pos, ...ctx.dest.pos, ctx.color === 'white') &&
        this.isPathClearEnoughForPremove(ctx, true)
      );
    }

    if (ctx.dest.pos[1] !== ctx.orig.pos[1] + step) {
      return false;
    }

    if (this.isDestOccupiedByEnemy(ctx)) {
      return true;
    }

    if (this.isDestOccupiedByFriendly(ctx)) {
      return this.isDestControlledByEnemy(ctx);
    }

    return (
      this.canSomeEnemyPawnAdvanceToDest(ctx) ||
      this.canBeCapturedBySomeEnemyEnPassant(
        pos2key([ctx.dest.pos[0], ctx.dest.pos[1] + step]),
        ctx.friendlies,
        ctx.enemies,
        ctx.lastMove
      ) ||
      this.isDestControlledByEnemy(ctx, ['pawn'])
    );
  };

  private knight: Mobility = (ctx: MobilityContext): boolean =>
    knightDir(...ctx.orig.pos, ...ctx.dest.pos) &&
    (!this.isDestOccupiedByFriendly(ctx) || this.isFriendlyOnDestAndAttacked(ctx));

  private bishop: Mobility = (ctx: MobilityContext): boolean =>
    bishopDir(...ctx.orig.pos, ...ctx.dest.pos) &&
    this.isPathClearEnoughForPremove(ctx, false) &&
    (!this.isDestOccupiedByFriendly(ctx) || this.isFriendlyOnDestAndAttacked(ctx));

  private rook: Mobility = (ctx: MobilityContext): boolean =>
    rookDir(...ctx.orig.pos, ...ctx.dest.pos) &&
    this.isPathClearEnoughForPremove(ctx, false) &&
    (!this.isDestOccupiedByFriendly(ctx) || this.isFriendlyOnDestAndAttacked(ctx));

  private queen: Mobility = (ctx: MobilityContext): boolean => this.bishop(ctx) || this.rook(ctx);

  private king: Mobility = (ctx: MobilityContext): boolean =>
    (kingDirNonCastling(...ctx.orig.pos, ...ctx.dest.pos) &&
      (!this.isDestOccupiedByFriendly(ctx) || this.isFriendlyOnDestAndAttacked(ctx))) ||
    (ctx.orig.pos[1] === ctx.dest.pos[1] &&
      ctx.orig.pos[1] === (ctx.color === 'white' ? 0 : 7) &&
      ctx.orig.pos[0] === 4 &&
      ((ctx.dest.pos[0] === 2 && ctx.rookFilesFriendlies.includes(0)) ||
        (ctx.dest.pos[0] === 6 && ctx.rookFilesFriendlies.includes(7))) &&
      // No non-rook friendly piece between king and rook side.
      squaresBetween(...ctx.orig.pos, ctx.dest.pos[0] > ctx.orig.pos[0] ? 7 : 1, ctx.dest.pos[1])
        .map((square) => ctx.allPieces.get(square))
        .every((piece) => !piece || !(piece.role !== 'rook' || piece.color !== ctx.color)));

  private mobilityByRole: Record<Role, Mobility> = {
    pawn: this.pawn,
    knight: this.knight,
    bishop: this.bishop,
    rook: this.rook,
    queen: this.queen,
    king: this.king
  };

  canPremove(ctx: MobilityContext): boolean {
    return this.mobilityByRole[ctx.role](ctx);
  }
}

export function lichessStylePremoveDests(
  fen: string,
  color: Color,
  lastMove?: readonly [Key, Key] | null
): Map<Key, Key[]> {
  const pieces = parsePieces(fen);
  const { friendlies, enemies } = partitionPiecesByColor(pieces, color);
  const rookFilesFriendlies = rookFilesOf(friendlies, color);
  const evaluator = new LichessStylePremove();
  const map = new Map<Key, Key[]>();
  const normalizedLastMove: [Key, Key] | undefined = lastMove ? [lastMove[0], lastMove[1]] : undefined;

  for (const [origKey, piece] of friendlies) {
    const origPos = key2pos(origKey);
    const dests: Key[] = [];

    for (const destKey of ALL_KEYS) {
      if (destKey === origKey) {
        continue;
      }

      const ctx: MobilityContext = {
        color: piece.color,
        role: piece.role,
        orig: { key: origKey, pos: origPos },
        dest: { key: destKey, pos: key2pos(destKey) },
        friendlies,
        enemies,
        allPieces: pieces,
        lastMove: normalizedLastMove,
        rookFilesFriendlies
      };

      if (evaluator.canPremove(ctx)) {
        dests.push(destKey);
      }
    }

    if (dests.length > 0) {
      map.set(origKey, dests);
    }
  }

  return map;
}
