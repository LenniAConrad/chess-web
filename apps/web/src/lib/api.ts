import type {
  SessionHistoryClearResponse,
  HintResponse,
  MoveResponse,
  NextResponse,
  PuzzleCountResponse,
  RevealResponse,
  SessionHistoryResponse,
  SessionTreeResponse,
  SkipVariationResponse,
  StartSessionResponse,
  VariationMode
} from '../types/api.js';
import * as offlineApi from './offlineApi.js';
import { IS_APP_BUILD } from './runtime.js';

/**
 * Thin API client used by the React app.
 * All requests include credentials so the anon-session cookie stays consistent.
 */
const API_BASE_URL =
  typeof import.meta.env.VITE_API_BASE_URL === 'string' && import.meta.env.VITE_API_BASE_URL.length > 0
    ? import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, '')
    : '';
const loadedSessionCache = new Map<string, StartSessionResponse>();
const loadedSessionPromiseCache = new Map<string, Promise<StartSessionResponse>>();

async function readErrorMessage(response: Response): Promise<string> {
  const text = await response.text();

  if (!text) {
    return `API request failed: ${response.status}`;
  }

  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    if (typeof parsed.error === 'string' && parsed.error.length > 0) {
      return parsed.error;
    }
  } catch {
    // Fall back to raw text when the response is not JSON.
  }

  return text;
}

async function requestJson<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return (await response.json()) as T;
}

async function requestGetJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'GET',
    credentials: 'include'
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return (await response.json()) as T;
}

export function cacheLoadedSession(snapshot: StartSessionResponse): void {
  loadedSessionPromiseCache.delete(snapshot.sessionId);
  loadedSessionCache.set(snapshot.sessionId, snapshot);
}

export function retainLoadedSessions(sessionIds: Iterable<string>): void {
  const keep = new Set(sessionIds);

  for (const cachedSessionId of loadedSessionCache.keys()) {
    if (!keep.has(cachedSessionId)) {
      loadedSessionCache.delete(cachedSessionId);
    }
  }

  for (const cachedSessionId of loadedSessionPromiseCache.keys()) {
    if (!keep.has(cachedSessionId)) {
      loadedSessionPromiseCache.delete(cachedSessionId);
    }
  }
}

export function startSession(
  mode: VariationMode,
  autoNext: boolean,
  puzzleId?: string,
  source: 'normal' | 'history' = 'normal'
): Promise<StartSessionResponse> {
  if (IS_APP_BUILD) {
    return offlineApi.startSession(mode, autoNext, puzzleId, source).then((response) => {
      cacheLoadedSession(response);
      return response;
    });
  }

  return requestJson<StartSessionResponse>('/api/v1/session/start', { mode, autoNext, puzzleId, source }).then(
    (response) => {
      cacheLoadedSession(response);
      return response;
    }
  );
}

export function playMove(
  sessionId: string,
  uciMove: string,
  skipSimilarVariations = false
): Promise<MoveResponse> {
  if (IS_APP_BUILD) {
    return offlineApi.playMove(sessionId, uciMove, skipSimilarVariations);
  }

  return requestJson<MoveResponse>('/api/v1/session/move', { sessionId, uciMove, skipSimilarVariations });
}

export function loadSession(sessionId: string): Promise<StartSessionResponse> {
  const cached = loadedSessionCache.get(sessionId);
  if (cached) {
    return Promise.resolve(cached);
  }

  const inFlight = loadedSessionPromiseCache.get(sessionId);
  if (inFlight) {
    return inFlight;
  }

  const request = (IS_APP_BUILD
    ? offlineApi.loadSession(sessionId)
    : requestJson<StartSessionResponse>('/api/v1/session/load', { sessionId }))
    .then((response) => {
      cacheLoadedSession(response);
      return response;
    })
    .catch((error) => {
      loadedSessionPromiseCache.delete(sessionId);
      throw error;
    });

  loadedSessionPromiseCache.set(sessionId, request);
  return request;
}

export function refreshSession(sessionId: string): Promise<StartSessionResponse> {
  const request = IS_APP_BUILD
    ? offlineApi.refreshSession(sessionId)
    : requestJson<StartSessionResponse>('/api/v1/session/load', { sessionId });

  return request.then((response) => {
    cacheLoadedSession(response);
    return response;
  });
}

export function restartSession(
  sessionId: string,
  mode: VariationMode,
  autoNext: boolean
): Promise<StartSessionResponse> {
  if (IS_APP_BUILD) {
    return offlineApi.restartSession(sessionId, mode, autoNext).then((response) => {
      cacheLoadedSession(response);
      return response;
    });
  }

  return requestJson<StartSessionResponse>('/api/v1/session/restart', { sessionId, mode, autoNext }).then(
    (response) => {
      cacheLoadedSession(response);
      return response;
    }
  );
}

export function getHint(sessionId: string): Promise<HintResponse> {
  if (IS_APP_BUILD) {
    return offlineApi.getHint(sessionId);
  }

  return requestJson<HintResponse>('/api/v1/session/hint', { sessionId });
}

export function getSessionHistory(
  sessionId: string,
  limit = 24,
  includeCurrent = false
): Promise<SessionHistoryResponse> {
  if (IS_APP_BUILD) {
    return offlineApi.getSessionHistory(sessionId, limit, includeCurrent);
  }

  return requestJson<SessionHistoryResponse>('/api/v1/session/history', {
    sessionId,
    limit,
    includeCurrent
  });
}

export function clearSessionHistory(sessionId: string): Promise<SessionHistoryClearResponse> {
  if (IS_APP_BUILD) {
    return offlineApi.clearSessionHistory(sessionId);
  }

  return requestJson<SessionHistoryClearResponse>('/api/v1/session/history/clear', { sessionId });
}

export function getSessionTree(sessionId: string): Promise<SessionTreeResponse> {
  if (IS_APP_BUILD) {
    return offlineApi.getSessionTree(sessionId);
  }

  return requestJson<SessionTreeResponse>('/api/v1/session/tree', { sessionId });
}

export function getPuzzleCount(): Promise<PuzzleCountResponse> {
  if (IS_APP_BUILD) {
    return offlineApi.getPuzzleCount();
  }

  return requestGetJson<PuzzleCountResponse>('/api/v1/puzzles/count');
}

export function revealSolution(
  sessionId: string,
  source: 'manual' | 'auto' = 'manual',
  skipSimilarVariations = false
): Promise<RevealResponse> {
  if (IS_APP_BUILD) {
    return offlineApi.revealSolution(sessionId, source, skipSimilarVariations);
  }

  return requestJson<RevealResponse>('/api/v1/session/reveal', { sessionId, source, skipSimilarVariations });
}

export function skipVariation(sessionId: string, skipSimilarVariations = false): Promise<SkipVariationResponse> {
  if (IS_APP_BUILD) {
    return offlineApi.skipVariation(sessionId, skipSimilarVariations);
  }

  return requestJson<SkipVariationResponse>('/api/v1/session/skip-variation', { sessionId, skipSimilarVariations });
}

export function nextPuzzle(
  sessionId: string,
  mode: VariationMode,
  autoNext: boolean
): Promise<NextResponse> {
  if (IS_APP_BUILD) {
    return offlineApi.nextPuzzle(sessionId, mode, autoNext);
  }

  return requestJson<NextResponse>('/api/v1/session/next', { sessionId, mode, autoNext });
}

export function prefetchNextPuzzle(
  sessionId: string,
  mode: VariationMode,
  autoNext: boolean
): Promise<StartSessionResponse> {
  if (IS_APP_BUILD) {
    return offlineApi.prefetchNextPuzzle(sessionId, mode, autoNext).then((response) => {
      cacheLoadedSession(response);
      return response;
    });
  }

  return requestJson<StartSessionResponse>('/api/v1/session/prefetch-next', { sessionId, mode, autoNext }).then(
    (response) => {
      cacheLoadedSession(response);
      return response;
    }
  );
}
