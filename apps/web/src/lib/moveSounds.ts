export type MoveSoundType = 'move' | 'capture' | 'castle' | 'check';

type BaseSoundType = 'move' | 'capture' | 'check';
const BASE_SOUND_TYPES: BaseSoundType[] = ['move', 'capture', 'check'];

function withBasePath(relativePath: string): string {
  const base = import.meta.env.BASE_URL ?? '/';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  return `${normalizedBase}${relativePath.replace(/^\/+/, '')}`;
}

const SOUND_URLS: Record<BaseSoundType, string> = {
  move: withBasePath('sounds/lichess-standard/Move.ogg'),
  capture: withBasePath('sounds/lichess-standard/Capture.ogg'),
  check: withBasePath('sounds/lichess-standard/Check.ogg')
};

const BASE_VOLUME = 1;
const SOUND_POOL_SIZE = 4;

let cachedPools: Partial<Record<BaseSoundType, HTMLAudioElement[]>> = {};
let preloadLinksInjected = false;

function injectSoundPreloads(): void {
  if (typeof document === 'undefined' || preloadLinksInjected) {
    return;
  }

  preloadLinksInjected = true;

  for (const type of BASE_SOUND_TYPES) {
    const href = SOUND_URLS[type];
    const existing = document.head.querySelector(`link[rel="preload"][as="audio"][href="${href}"]`);
    if (existing) {
      continue;
    }

    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'audio';
    link.href = href;
    document.head.append(link);
  }
}

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

export function primeMoveSounds(): void {
  injectSoundPreloads();
  for (const type of BASE_SOUND_TYPES) {
    getSoundPool(type);
  }
}

export function playMoveSound(type: MoveSoundType): void {
  if (type === 'castle') {
    playBaseSound('move');
    return;
  }

  playBaseSound(type);
}
