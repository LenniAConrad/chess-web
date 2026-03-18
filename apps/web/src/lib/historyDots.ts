import type { SessionHistoryItem } from '../types/api.js';

export type HistoryDotTone = 'green' | 'yellow' | 'orange' | 'red' | 'gray' | 'blue';

export function getHistoryDotTone(item: SessionHistoryItem): HistoryDotTone {
  if (item.autoplayUsed) {
    return 'blue';
  }

  if (item.solved) {
    if (item.wrongMoveCount > 0) {
      return 'orange';
    }

    if (item.hintCount > 0) {
      return 'yellow';
    }

    return 'green';
  }

  if (
    item.wrongMoveCount === 0 &&
    item.hintCount === 0 &&
    !item.revealed &&
    !item.autoplayUsed
  ) {
    return 'gray';
  }

  return 'red';
}

export function getHistoryDotSymbol(tone: HistoryDotTone): string {
  if (tone === 'blue') {
    return 'A';
  }

  if (tone === 'red') {
    return '\u2715';
  }

  if (tone === 'gray') {
    return '\u2013';
  }

  return '\u2713';
}

export function getHistoryDotLabel(tone: HistoryDotTone): string {
  switch (tone) {
    case 'blue':
      return 'Autoplay';
    case 'green':
      return 'Solved clean';
    case 'yellow':
      return 'Solved with hints';
    case 'orange':
      return 'Solved with errors';
    case 'red':
      return 'Failed';
    case 'gray':
      return 'Not played';
    default:
      return 'Unknown';
  }
}
