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
const SOUND_UNLOCK_EVENTS = ['pointerdown', 'touchstart', 'keydown'] as const;

let cachedPools: Partial<Record<BaseSoundType, HTMLAudioElement[]>> = {};
let preloadLinksInjected = false;
let soundUnlockListenersAttached = false;
let soundUnlocked = false;
let poolCursorByType: Partial<Record<BaseSoundType, number>> = {};

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

function detachSoundUnlockListeners(): void {
  if (typeof document === 'undefined' || !soundUnlockListenersAttached) {
    return;
  }

  for (const eventName of SOUND_UNLOCK_EVENTS) {
    document.removeEventListener(eventName, handleSoundUnlockGesture, true);
  }

  soundUnlockListenersAttached = false;
}

function unlockMoveSoundsFromGesture(): void {
  if (typeof window === 'undefined' || soundUnlocked) {
    return;
  }

  soundUnlocked = true;
  detachSoundUnlockListeners();
}

function handleSoundUnlockGesture(): void {
  unlockMoveSoundsFromGesture();
}

function attachSoundUnlockListeners(): void {
  if (typeof document === 'undefined' || soundUnlockListenersAttached || soundUnlocked) {
    return;
  }

  for (const eventName of SOUND_UNLOCK_EVENTS) {
    document.addEventListener(eventName, handleSoundUnlockGesture, { capture: true, passive: true });
  }

  soundUnlockListenersAttached = true;
}

function pickPlayableAudio(type: BaseSoundType, pool: HTMLAudioElement[]): HTMLAudioElement | null {
  if (pool.length === 0) {
    return null;
  }

  const startIndex = poolCursorByType[type] ?? 0;

  for (let offset = 0; offset < pool.length; offset += 1) {
    const index = (startIndex + offset) % pool.length;
    const audio = pool[index];
    if (!audio) {
      continue;
    }
    if (audio.paused || audio.ended) {
      poolCursorByType[type] = (index + 1) % pool.length;
      return audio;
    }
  }

  const fallbackIndex = startIndex % pool.length;
  const fallback = pool[fallbackIndex] ?? null;
  if (!fallback) {
    return null;
  }
  poolCursorByType[type] = (fallbackIndex + 1) % pool.length;
  return fallback;
}

function playBaseSound(type: BaseSoundType): void {
  const pool = getSoundPool(type);
  if (!pool || pool.length === 0) {
    return;
  }

  const playable = pickPlayableAudio(type, pool);
  if (!playable) {
    return;
  }
  playable.currentTime = 0;
  playable.volume = BASE_VOLUME;
  void playable.play().catch(() => {
    attachSoundUnlockListeners();
  });
}

export function primeMoveSounds(): void {
  injectSoundPreloads();
  for (const type of BASE_SOUND_TYPES) {
    getSoundPool(type);
  }
  attachSoundUnlockListeners();
}

export function playMoveSound(type: MoveSoundType): void {
  if (type === 'castle') {
    playBaseSound('move');
    return;
  }

  playBaseSound(type);
}
