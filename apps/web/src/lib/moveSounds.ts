export type MoveSoundType = 'move' | 'capture' | 'castle' | 'check';

type BaseSoundType = 'move' | 'capture' | 'check';

function withBasePath(relativePath: string): string {
  const base = import.meta.env.BASE_URL ?? '/';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  return `${normalizedBase}${relativePath.replace(/^\/+/, '')}`;
}

const SOUND_URLS: Record<BaseSoundType, string> = {
  move: withBasePath('sounds/lichess-sfx/Move.ogg'),
  capture: withBasePath('sounds/lichess-sfx/Capture.ogg'),
  check: withBasePath('sounds/lichess-sfx/Check.ogg')
};

const BASE_VOLUME = 1;
const CASTLE_SECOND_SOUND_DELAY_MS = 65;
const SOUND_POOL_SIZE = 4;

let cachedPools: Partial<Record<BaseSoundType, HTMLAudioElement[]>> = {};

function getSoundPool(type: BaseSoundType): HTMLAudioElement[] | null {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') {
    return null;
  }

  const existing = cachedPools[type];
  if (existing) {
    return existing;
  }

  const pool = Array.from({ length: SOUND_POOL_SIZE }, () => {
    const audio = new Audio(SOUND_URLS[type]);
    audio.preload = 'auto';
    audio.volume = BASE_VOLUME;
    audio.load();
    return audio;
  });
  cachedPools[type] = pool;
  return pool;
}

function playBaseSound(type: BaseSoundType): void {
  const pool = getSoundPool(type);
  if (!pool || pool.length === 0) {
    return;
  }

  const playable = pool.find((audio) => audio.paused || audio.ended) ?? null;
  if (!playable) {
    return;
  }
  playable.currentTime = 0;
  playable.volume = BASE_VOLUME;
  void playable.play().catch(() => {
    // Ignore autoplay/user-gesture errors.
  });
}

export function playMoveSound(type: MoveSoundType): void {
  if (type === 'castle') {
    playBaseSound('move');
    setTimeout(() => {
      playBaseSound('move');
    }, CASTLE_SECOND_SOUND_DELAY_MS);
    return;
  }

  playBaseSound(type);
}
