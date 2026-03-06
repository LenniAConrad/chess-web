import type { MoveResponse, PuzzleNode, SessionCursor, SessionSnapshot, VariationMode } from './types.js';

function sideToMove(fen: string): 'w' | 'b' {
  return (fen.split(' ')[1] === 'b' ? 'b' : 'w') as 'w' | 'b';
}

function commonPrefixLength(a: number[], b: number[]): number {
  const limit = Math.min(a.length, b.length);
  let index = 0;
  while (index < limit && a[index] === b[index]) {
    index += 1;
  }
  return index;
}

export interface PuzzleSessionEngineOptions {
  nodes: PuzzleNode[];
  rootNodeId: number;
  mode: VariationMode;
}

export class PuzzleSessionEngine {
  private readonly mode: VariationMode;
  private readonly rootNodeId: number;
  private readonly userSide: 'w' | 'b';
  private readonly nodeMap = new Map<number, PuzzleNode>();
  private readonly childrenMap = new Map<number, PuzzleNode[]>();
  private readonly lines: number[][];

  constructor(options: PuzzleSessionEngineOptions) {
    this.mode = options.mode;
    this.rootNodeId = options.rootNodeId;

    for (const node of options.nodes) {
      this.nodeMap.set(node.id, node);
    }

    const root = this.nodeMap.get(this.rootNodeId);
    if (!root) {
      throw new Error('Root node not found');
    }

    this.userSide = sideToMove(root.fenAfter);

    for (const node of options.nodes) {
      if (node.parentId === null) {
        continue;
      }
      const siblings = this.childrenMap.get(node.parentId) ?? [];
      siblings.push(node);
      this.childrenMap.set(node.parentId, siblings);
    }

    for (const siblings of this.childrenMap.values()) {
      siblings.sort((a, b) => a.siblingOrder - b.siblingOrder || a.id - b.id);
    }

    this.lines = this.buildLines();
    if (this.lines.length === 0) {
      this.lines = [[this.rootNodeId]];
    }
  }

  get totalLines(): number {
    return this.lines.length;
  }

  getInitialCursor(): SessionCursor {
    return { lineIndex: 0, cursorIndex: 0 };
  }

  normalizeCursor(input: unknown): SessionCursor {
    const asRecord = (input ?? {}) as Record<string, unknown>;
    const lineIndexRaw = Number(asRecord.lineIndex ?? 0);
    const lineIndex = Number.isFinite(lineIndexRaw)
      ? Math.min(Math.max(0, Math.floor(lineIndexRaw)), Math.max(0, this.lines.length - 1))
      : 0;

    const line = this.lines[lineIndex] ?? [this.rootNodeId];
    const cursorIndexRaw = Number(asRecord.cursorIndex ?? 0);
    const cursorIndex = Number.isFinite(cursorIndexRaw)
      ? Math.min(Math.max(0, Math.floor(cursorIndexRaw)), Math.max(0, line.length - 1))
      : 0;

    return { lineIndex, cursorIndex };
  }

  buildSnapshot(cursor: SessionCursor, solved = false): SessionSnapshot {
    const line = this.lines[cursor.lineIndex] ?? [this.rootNodeId];
    const nodeId = line[cursor.cursorIndex] ?? this.rootNodeId;
    const node = this.nodeMap.get(nodeId);
    if (!node) {
      throw new Error(`Missing node ${nodeId}`);
    }

    return {
      nodeId,
      fen: node.fenAfter,
      toMove: sideToMove(node.fenAfter),
      variationMode: this.mode,
      lineIndex: cursor.lineIndex,
      totalLines: this.lines.length,
      completedBranches: solved ? this.lines.length : cursor.lineIndex
    };
  }

  hint(cursorInput: SessionCursor): { pieceFromSquare: string | null; snapshot: SessionSnapshot; solved: boolean } {
    const { cursor, solved } = this.sync(cursorInput);
    const nextMove = this.getNextUserMoveNode(cursor);
    return {
      pieceFromSquare: nextMove ? nextMove.uci.slice(0, 2) : null,
      snapshot: this.buildSnapshot(cursor, solved),
      solved
    };
  }

  reveal(cursorInput: SessionCursor): {
    cursor: SessionCursor;
    solved: boolean;
    bestMoveUci: string | null;
    bestMoveSan: string | null;
    afterFen: string | null;
    autoPlayedMoves: string[];
    autoPlayStartFen: string | null;
    rewindFens: string[];
    snapshot: SessionSnapshot;
  } {
    const synced = this.sync(cursorInput);
    let cursor = synced.cursor;
    const autoPlayedMoves = [...synced.autoPlayedMoves];

    if (synced.solved) {
      return {
        cursor,
        solved: true,
        bestMoveUci: null,
        bestMoveSan: null,
        afterFen: null,
        autoPlayedMoves,
        autoPlayStartFen: null,
        rewindFens: [],
        snapshot: this.buildSnapshot(cursor, true)
      };
    }

    const expected = this.getNextUserMoveNode(cursor);
    if (!expected) {
      return {
        cursor,
        solved: true,
        bestMoveUci: null,
        bestMoveSan: null,
        afterFen: null,
        autoPlayedMoves,
        autoPlayStartFen: null,
        rewindFens: [],
        snapshot: this.buildSnapshot(cursor, true)
      };
    }

    cursor = { ...cursor, cursorIndex: cursor.cursorIndex + 1 };
    const postMoveSync = this.sync(cursor);
    cursor = postMoveSync.cursor;
    autoPlayedMoves.push(...postMoveSync.autoPlayedMoves);

    return {
      cursor,
      solved: postMoveSync.solved,
      bestMoveUci: expected.uci,
      bestMoveSan: expected.san,
      afterFen: expected.fenAfter,
      autoPlayedMoves,
      autoPlayStartFen: postMoveSync.autoPlayStartFen,
      rewindFens: postMoveSync.rewindFens,
      snapshot: this.buildSnapshot(cursor, postMoveSync.solved)
    };
  }

  skipVariation(cursorInput: SessionCursor): {
    skipped: boolean;
    cursor: SessionCursor;
    solved: boolean;
    snapshot: SessionSnapshot;
    autoPlayedMoves: string[];
    autoPlayStartFen: string | null;
    rewindFens: string[];
    remainingBranches: number;
  } {
    let cursor = this.normalizeCursor(cursorInput);

    if (this.mode === 'mainline' || this.lines.length <= 1) {
      const synced = this.sync(cursor);
      return {
        skipped: false,
        cursor: synced.cursor,
        solved: synced.solved,
        snapshot: this.buildSnapshot(synced.cursor, synced.solved),
        autoPlayedMoves: synced.autoPlayedMoves,
        autoPlayStartFen: synced.autoPlayStartFen,
        rewindFens: synced.rewindFens,
        remainingBranches: Math.max(0, this.lines.length - (synced.cursor.lineIndex + 1))
      };
    }

    if (cursor.lineIndex >= this.lines.length - 1) {
      const snapshot = this.buildSnapshot(cursor, true);
      return {
        skipped: true,
        cursor,
        solved: true,
        snapshot,
        autoPlayedMoves: [],
        autoPlayStartFen: null,
        rewindFens: [],
        remainingBranches: 0
      };
    }

    const previousLine = this.lines[cursor.lineIndex] ?? [this.rootNodeId];
    cursor = { ...cursor, lineIndex: cursor.lineIndex + 1 };
    const nextLine = this.lines[cursor.lineIndex] ?? [this.rootNodeId];
    const lcp = commonPrefixLength(previousLine, nextLine);
    cursor.cursorIndex = Math.max(0, lcp - 1);

    const synced = this.sync(cursor);
    return {
      skipped: true,
      cursor: synced.cursor,
      solved: synced.solved,
      snapshot: this.buildSnapshot(synced.cursor, synced.solved),
      autoPlayedMoves: synced.autoPlayedMoves,
      autoPlayStartFen: synced.autoPlayStartFen,
      rewindFens: synced.rewindFens,
      remainingBranches: Math.max(0, this.lines.length - (synced.cursor.lineIndex + 1))
    };
  }

  playUserMove(cursorInput: SessionCursor, uciMove: string): { cursor: SessionCursor; solved: boolean } & MoveResponse {
    const synced = this.sync(cursorInput);
    let cursor = synced.cursor;
    const autoPlayedMoves = [...synced.autoPlayedMoves];

    if (synced.solved) {
      return {
        cursor,
        solved: true,
        result: 'completed',
        autoPlayedMoves,
        autoPlayStartFen: null,
        rewindFens: [],
        snapshot: this.buildSnapshot(cursor, true)
      };
    }

    const expectedNode = this.getNextUserMoveNode(cursor);
    if (!expectedNode) {
      return {
        cursor,
        solved: true,
        result: 'completed',
        autoPlayedMoves,
        autoPlayStartFen: null,
        rewindFens: [],
        snapshot: this.buildSnapshot(cursor, true)
      };
    }

    if (expectedNode.uci.toLowerCase() !== uciMove.toLowerCase()) {
      return {
        cursor,
        solved: false,
        result: 'incorrect',
        expectedBestMoveUci: expectedNode.uci,
        autoPlayedMoves,
        autoPlayStartFen: null,
        rewindFens: [],
        snapshot: this.buildSnapshot(cursor, false)
      };
    }

    cursor = { ...cursor, cursorIndex: cursor.cursorIndex + 1 };

    const postMoveSync = this.sync(cursor);
    autoPlayedMoves.push(...postMoveSync.autoPlayedMoves);

    return {
      cursor: postMoveSync.cursor,
      solved: postMoveSync.solved,
      result: postMoveSync.solved ? 'completed' : 'correct',
      autoPlayedMoves,
      autoPlayStartFen: postMoveSync.autoPlayStartFen,
      rewindFens: postMoveSync.rewindFens,
      snapshot: this.buildSnapshot(postMoveSync.cursor, postMoveSync.solved)
    };
  }

  private buildLines(): number[][] {
    const lines: number[][] = [];

    const walk = (nodeId: number, path: number[]): void => {
      const children = this.childrenMap.get(nodeId) ?? [];
      if (children.length === 0) {
        lines.push(path);
        return;
      }

      const node = this.nodeMap.get(nodeId);
      if (!node) {
        return;
      }

      const turn = sideToMove(node.fenAfter);
      if (turn === this.userSide) {
        const mainlineChild = children.find((child) => child.isMainline) ?? children[0];
        if (!mainlineChild) {
          lines.push(path);
          return;
        }
        walk(mainlineChild.id, [...path, mainlineChild.id]);
        return;
      }

      if (this.mode === 'mainline') {
        const mainlineChild = children.find((child) => child.isMainline) ?? children[0];
        if (!mainlineChild) {
          lines.push(path);
          return;
        }
        walk(mainlineChild.id, [...path, mainlineChild.id]);
        return;
      }

      for (const child of children) {
        walk(child.id, [...path, child.id]);
      }
    };

    walk(this.rootNodeId, [this.rootNodeId]);
    return lines;
  }

  private getNextUserMoveNode(cursor: SessionCursor): PuzzleNode | null {
    const line = this.lines[cursor.lineIndex] ?? [this.rootNodeId];
    const currentNodeId = line[cursor.cursorIndex] ?? this.rootNodeId;
    const currentNode = this.nodeMap.get(currentNodeId);
    if (!currentNode) {
      return null;
    }

    if (sideToMove(currentNode.fenAfter) !== this.userSide) {
      return null;
    }

    const nextNodeId = line[cursor.cursorIndex + 1];
    if (!nextNodeId) {
      return null;
    }

    return this.nodeMap.get(nextNodeId) ?? null;
  }

  private sync(inputCursor: SessionCursor): {
    cursor: SessionCursor;
    solved: boolean;
    autoPlayedMoves: string[];
    autoPlayStartFen: string | null;
    rewindFens: string[];
  } {
    const cursor = this.normalizeCursor(inputCursor);
    const autoPlayedMoves: string[] = [];
    let autoPlayStartFen: string | null = null;
    const rewindFens: string[] = [];

    while (true) {
      const line = this.lines[cursor.lineIndex] ?? [this.rootNodeId];
      const currentNodeId = line[cursor.cursorIndex] ?? this.rootNodeId;
      const currentNode = this.nodeMap.get(currentNodeId);
      if (!currentNode) {
        return { cursor, solved: true, autoPlayedMoves, autoPlayStartFen, rewindFens };
      }

      let progressedOpponent = false;
      while (true) {
        const nextNodeId = line[cursor.cursorIndex + 1];
        if (!nextNodeId) {
          break;
        }

        const currentLineNodeId = line[cursor.cursorIndex];
        const currentLineNode =
          currentLineNodeId === undefined ? currentNode : this.nodeMap.get(currentLineNodeId) ?? currentNode;
        const turn = sideToMove(currentLineNode.fenAfter);
        if (turn === this.userSide) {
          break;
        }

        const nextNode = this.nodeMap.get(nextNodeId);
        if (!nextNode) {
          break;
        }

        if (autoPlayStartFen === null) {
          autoPlayStartFen = currentLineNode.fenAfter;
        }

        cursor.cursorIndex += 1;
        if (nextNode.uci) {
          autoPlayedMoves.push(nextNode.uci);
        }
        progressedOpponent = true;
      }

      const activeLine = this.lines[cursor.lineIndex] ?? [this.rootNodeId];
      const atLineEnd = cursor.cursorIndex >= activeLine.length - 1;
      if (!atLineEnd) {
        return { cursor, solved: false, autoPlayedMoves, autoPlayStartFen, rewindFens };
      }

      if (cursor.lineIndex >= this.lines.length - 1) {
        return { cursor, solved: true, autoPlayedMoves, autoPlayStartFen, rewindFens };
      }

      const previousLine = activeLine;
      const previousCursorIndex = cursor.cursorIndex;
      cursor.lineIndex += 1;
      const nextLine = this.lines[cursor.lineIndex] ?? [this.rootNodeId];
      const lcp = commonPrefixLength(previousLine, nextLine);
      const targetCursorIndex = Math.max(0, lcp - 1);

      if (previousCursorIndex > targetCursorIndex) {
        for (let index = previousCursorIndex - 1; index >= targetCursorIndex; index -= 1) {
          const nodeId = previousLine[index];
          if (!nodeId) {
            continue;
          }
          const node = this.nodeMap.get(nodeId);
          if (node) {
            rewindFens.push(node.fenAfter);
          }
        }
      }

      cursor.cursorIndex = targetCursorIndex;

      if (!progressedOpponent && this.lines.length === 1) {
        return { cursor, solved: true, autoPlayedMoves, autoPlayStartFen, rewindFens };
      }
    }
  }
}
