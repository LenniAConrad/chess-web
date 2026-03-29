import type {
  MoveResponse,
  PuzzleNode,
  SessionAdvanceOptions,
  SessionCursor,
  SessionSnapshot,
  VariationMode
} from './types.js';

/**
 * Lightweight FEN helper used to decide whose turn it is at a node.
 */
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
  /** Full puzzle move tree (all nodes) for one puzzle. */
  nodes: PuzzleNode[];
  /** Root node id in `nodes`. */
  rootNodeId: number;
  /** Variation traversal strategy. */
  mode: VariationMode;
}

/**
 * Deterministic puzzle session engine.
 *
 * Responsibilities:
 * - Build candidate lines from the move tree.
 * - Validate user input against the expected continuation.
 * - Advance cursor and auto-play opponent moves.
 * - Emit rewind information when switching between variation branches.
 *
 * Non-responsibilities:
 * - Persistence
 * - HTTP transport
 * - UI rendering concerns
 */
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

  /**
   * Defensive cursor normalization for persisted/untrusted cursor payloads.
   */
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

  hint(cursorInput: SessionCursor): {
    pieceFromSquare: string | null;
    bestMoveUci: string | null;
    snapshot: SessionSnapshot;
    solved: boolean;
  } {
    const { cursor, solved } = this.sync(cursorInput);
    const nextMove = this.getNextUserMoveNode(cursor);
    return {
      pieceFromSquare: nextMove ? nextMove.uci.slice(0, 2) : null,
      bestMoveUci: nextMove?.uci ?? null,
      snapshot: this.buildSnapshot(cursor, solved),
      solved
    };
  }

  reveal(cursorInput: SessionCursor, options: SessionAdvanceOptions = {}): {
    cursor: SessionCursor;
    solved: boolean;
    bestMoveUci: string | null;
    bestMoveSan: string | null;
    afterFen: string | null;
    autoPlayedMoves: string[];
    autoPlayStartFen: string | null;
    rewindFens: string[];
    skippedSimilarVariations: number;
    snapshot: SessionSnapshot;
  } {
    const synced = this.sync(cursorInput, options);
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
        skippedSimilarVariations: synced.skippedSimilarVariations,
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
        skippedSimilarVariations: synced.skippedSimilarVariations,
        snapshot: this.buildSnapshot(cursor, true)
      };
    }

    cursor = { ...cursor, cursorIndex: cursor.cursorIndex + 1 };
    const postMoveSync = this.sync(cursor, options);
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
      skippedSimilarVariations: postMoveSync.skippedSimilarVariations,
      snapshot: this.buildSnapshot(cursor, postMoveSync.solved)
    };
  }

  skipVariation(cursorInput: SessionCursor, options: SessionAdvanceOptions = {}): {
    skipped: boolean;
    cursor: SessionCursor;
    solved: boolean;
    snapshot: SessionSnapshot;
    autoPlayedMoves: string[];
    autoPlayStartFen: string | null;
    rewindFens: string[];
    skippedSimilarVariations: number;
    remainingBranches: number;
  } {
    let cursor = this.normalizeCursor(cursorInput);

    if (this.mode === 'mainline' || this.lines.length <= 1) {
      const synced = this.sync(cursor, options);
      return {
        skipped: false,
        cursor: synced.cursor,
        solved: synced.solved,
        snapshot: this.buildSnapshot(synced.cursor, synced.solved),
        autoPlayedMoves: synced.autoPlayedMoves,
        autoPlayStartFen: synced.autoPlayStartFen,
        rewindFens: synced.rewindFens,
        skippedSimilarVariations: synced.skippedSimilarVariations,
        remainingBranches: Math.max(0, this.lines.length - (synced.cursor.lineIndex + 1))
      };
    }

    const transition = this.getNextLineTransition(
      cursor.lineIndex,
      cursor.cursorIndex,
      options.skipSimilarVariations ?? false
    );

    if (transition.nextLineIndex === null) {
      const snapshot = this.buildSnapshot(cursor, true);
      return {
        skipped: true,
        cursor,
        solved: true,
        snapshot,
        autoPlayedMoves: [],
        autoPlayStartFen: null,
        rewindFens: transition.rewindFens,
        skippedSimilarVariations: transition.skippedSimilarVariations,
        remainingBranches: 0
      };
    }

    cursor = {
      ...cursor,
      lineIndex: transition.nextLineIndex,
      cursorIndex: transition.targetCursorIndex
    };
    const synced = this.sync(cursor, options);
    return {
      skipped: true,
      cursor: synced.cursor,
      solved: synced.solved,
      snapshot: this.buildSnapshot(synced.cursor, synced.solved),
      autoPlayedMoves: synced.autoPlayedMoves,
      autoPlayStartFen: synced.autoPlayStartFen,
      rewindFens: [...transition.rewindFens, ...synced.rewindFens],
      skippedSimilarVariations: transition.skippedSimilarVariations + synced.skippedSimilarVariations,
      remainingBranches: Math.max(0, this.lines.length - (synced.cursor.lineIndex + 1))
    };
  }

  playUserMove(
    cursorInput: SessionCursor,
    uciMove: string,
    options: SessionAdvanceOptions = {}
  ): { cursor: SessionCursor; solved: boolean } & MoveResponse {
    const synced = this.sync(cursorInput, options);
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
        skippedSimilarVariations: synced.skippedSimilarVariations,
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
        skippedSimilarVariations: synced.skippedSimilarVariations,
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
        skippedSimilarVariations: synced.skippedSimilarVariations,
        snapshot: this.buildSnapshot(cursor, false)
      };
    }

    cursor = { ...cursor, cursorIndex: cursor.cursorIndex + 1 };

    const postMoveSync = this.sync(cursor, options);
    autoPlayedMoves.push(...postMoveSync.autoPlayedMoves);

    return {
      cursor: postMoveSync.cursor,
      solved: postMoveSync.solved,
      result: postMoveSync.solved ? 'completed' : 'correct',
      autoPlayedMoves,
      autoPlayStartFen: postMoveSync.autoPlayStartFen,
      rewindFens: postMoveSync.rewindFens,
      skippedSimilarVariations: postMoveSync.skippedSimilarVariations,
      snapshot: this.buildSnapshot(postMoveSync.cursor, postMoveSync.solved)
    };
  }

  private buildLines(): number[][] {
    /**
     * DFS over the tree where user turns contribute decision points and
     * opponent turns are auto-played later in `sync`.
     */
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

  private lineAt(lineIndex: number): number[] {
    return this.lines[lineIndex] ?? [this.rootNodeId];
  }

  private fenStateKey(fen: string): string {
    return fen.split(' ').slice(0, 4).join(' ');
  }

  private remainingUserMoveSignature(line: number[], cursorIndex: number): string {
    const moves: string[] = [];

    for (let index = cursorIndex + 1; index < line.length; index += 1) {
      const nodeId = line[index];
      if (!nodeId) {
        continue;
      }

      const node = this.nodeMap.get(nodeId);
      if (node?.actor === 'user' && node.uci) {
        moves.push(node.uci.toLowerCase());
      }
    }

    return moves.join('|');
  }

  private positionContinuationSignature(lineIndex: number, cursorIndex: number): string | null {
    const line = this.lineAt(lineIndex);
    const nodeId = line[cursorIndex] ?? this.rootNodeId;
    const node = this.nodeMap.get(nodeId);
    if (!node) {
      return null;
    }

    return `${this.fenStateKey(node.fenAfter)}::${this.remainingUserMoveSignature(line, cursorIndex)}`;
  }

  private isDecisionCursor(line: number[], cursorIndex: number): boolean {
    const nodeId = line[cursorIndex] ?? this.rootNodeId;
    const node = this.nodeMap.get(nodeId);
    if (!node) {
      return false;
    }

    return cursorIndex >= line.length - 1 || sideToMove(node.fenAfter) === this.userSide;
  }

  private hasCompletedEquivalentPosition(lineIndex: number, cursorIndex: number): boolean {
    const candidateSignature = this.positionContinuationSignature(lineIndex, cursorIndex);
    if (!candidateSignature) {
      return false;
    }

    for (let completedLineIndex = 0; completedLineIndex < lineIndex; completedLineIndex += 1) {
      const completedLine = this.lineAt(completedLineIndex);
      for (let completedCursorIndex = 0; completedCursorIndex < completedLine.length; completedCursorIndex += 1) {
        if (!this.isDecisionCursor(completedLine, completedCursorIndex)) {
          continue;
        }

        if (this.positionContinuationSignature(completedLineIndex, completedCursorIndex) === candidateSignature) {
          return true;
        }
      }
    }

    return false;
  }

  private getNextLineTransition(
    referenceLineIndex: number,
    previousCursorIndex: number,
    skipSimilarVariations: boolean
  ): {
    nextLineIndex: number | null;
    targetCursorIndex: number;
    rewindFens: string[];
    skippedSimilarVariations: number;
  } {
    const referenceLine = this.lineAt(referenceLineIndex);
    let candidateLineIndex = referenceLineIndex + 1;
    let skippedSimilarVariations = 0;

    while (skipSimilarVariations && candidateLineIndex < this.lines.length) {
      const candidateLine = this.lineAt(candidateLineIndex);
      const targetCursorIndex = Math.max(0, commonPrefixLength(referenceLine, candidateLine) - 1);
      const referenceSignature = this.remainingUserMoveSignature(referenceLine, targetCursorIndex);
      const candidateSignature = this.remainingUserMoveSignature(candidateLine, targetCursorIndex);

      if (referenceSignature !== candidateSignature) {
        break;
      }

      skippedSimilarVariations += 1;
      candidateLineIndex += 1;
    }

    if (candidateLineIndex >= this.lines.length) {
      return {
        nextLineIndex: null,
        targetCursorIndex: previousCursorIndex,
        rewindFens: [],
        skippedSimilarVariations
      };
    }

    const nextLine = this.lineAt(candidateLineIndex);
    const targetCursorIndex = Math.max(0, commonPrefixLength(referenceLine, nextLine) - 1);
    const rewindFens: string[] = [];

    if (previousCursorIndex > targetCursorIndex) {
      for (let index = previousCursorIndex - 1; index >= targetCursorIndex; index -= 1) {
        const nodeId = referenceLine[index];
        if (!nodeId) {
          continue;
        }

        const node = this.nodeMap.get(nodeId);
        if (node) {
          rewindFens.push(node.fenAfter);
        }
      }
    }

    return {
      nextLineIndex: candidateLineIndex,
      targetCursorIndex,
      rewindFens,
      skippedSimilarVariations
    };
  }

  private sync(inputCursor: SessionCursor, options: SessionAdvanceOptions = {}): {
    cursor: SessionCursor;
    solved: boolean;
    autoPlayedMoves: string[];
    autoPlayStartFen: string | null;
    rewindFens: string[];
    skippedSimilarVariations: number;
  } {
    /**
     * Sync cursor to the next user decision:
     * - Auto-play opponent-only steps.
     * - If line ends, advance to next branch and provide rewind FENs.
     * - Mark solved when no remaining branches exist.
     */
    const cursor = this.normalizeCursor(inputCursor);
    const autoPlayedMoves: string[] = [];
    let autoPlayStartFen: string | null = null;
    const rewindFens: string[] = [];
    let skippedSimilarVariations = 0;

    while (true) {
      const line = this.lines[cursor.lineIndex] ?? [this.rootNodeId];
      const currentNodeId = line[cursor.cursorIndex] ?? this.rootNodeId;
      const currentNode = this.nodeMap.get(currentNodeId);
      if (!currentNode) {
        return { cursor, solved: true, autoPlayedMoves, autoPlayStartFen, rewindFens, skippedSimilarVariations };
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
        if ((options.skipSimilarVariations ?? false) && this.hasCompletedEquivalentPosition(cursor.lineIndex, cursor.cursorIndex)) {
          const transition = this.getNextLineTransition(cursor.lineIndex, cursor.cursorIndex, true);
          skippedSimilarVariations += transition.skippedSimilarVariations + 1;

          if (transition.nextLineIndex === null) {
            return { cursor, solved: true, autoPlayedMoves, autoPlayStartFen, rewindFens, skippedSimilarVariations };
          }

          rewindFens.push(...transition.rewindFens);
          cursor.lineIndex = transition.nextLineIndex;
          cursor.cursorIndex = transition.targetCursorIndex;
          continue;
        }

        return { cursor, solved: false, autoPlayedMoves, autoPlayStartFen, rewindFens, skippedSimilarVariations };
      }

      const previousCursorIndex = cursor.cursorIndex;
      const transition = this.getNextLineTransition(
        cursor.lineIndex,
        previousCursorIndex,
        options.skipSimilarVariations ?? false
      );
      skippedSimilarVariations += transition.skippedSimilarVariations;

      if (transition.nextLineIndex === null) {
        return { cursor, solved: true, autoPlayedMoves, autoPlayStartFen, rewindFens, skippedSimilarVariations };
      }

      rewindFens.push(...transition.rewindFens);
      cursor.lineIndex = transition.nextLineIndex;
      cursor.cursorIndex = transition.targetCursorIndex;

      if (!progressedOpponent && this.lines.length === 1) {
        return { cursor, solved: true, autoPlayedMoves, autoPlayStartFen, rewindFens, skippedSimilarVariations };
      }
    }
  }
}
