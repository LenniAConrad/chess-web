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

/**
 * Thin API client used by the React app.
 * All requests include credentials so the anon-session cookie stays consistent.
 */
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001';
const loadedSessionCache = new Map<string, StartSessionResponse>();
const loadedSessionPromiseCache = new Map<string, Promise<StartSessionResponse>>();

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
    const text = await response.text();
    throw new Error(text || `API request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

async function requestGetJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'GET',
    credentials: 'include'
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `API request failed: ${response.status}`);
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
  return requestJson<StartSessionResponse>('/api/v1/session/start', { mode, autoNext, puzzleId, source }).then(
    (response) => {
      cacheLoadedSession(response);
      return response;
    }
  );
}

export function playMove(sessionId: string, uciMove: string): Promise<MoveResponse> {
  return requestJson<MoveResponse>('/api/v1/session/move', { sessionId, uciMove });
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

  const request = requestJson<StartSessionResponse>('/api/v1/session/load', { sessionId })
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

export function getHint(sessionId: string): Promise<HintResponse> {
  return requestJson<HintResponse>('/api/v1/session/hint', { sessionId });
}

export function getSessionHistory(
  sessionId: string,
  limit = 24,
  includeCurrent = false
): Promise<SessionHistoryResponse> {
  return requestJson<SessionHistoryResponse>('/api/v1/session/history', {
    sessionId,
    limit,
    includeCurrent
  });
}

export function clearSessionHistory(sessionId: string): Promise<SessionHistoryClearResponse> {
  return requestJson<SessionHistoryClearResponse>('/api/v1/session/history/clear', { sessionId });
}

export function getSessionTree(sessionId: string): Promise<SessionTreeResponse> {
  return requestJson<SessionTreeResponse>('/api/v1/session/tree', { sessionId });
}

export function getPuzzleCount(): Promise<PuzzleCountResponse> {
  return requestGetJson<PuzzleCountResponse>('/api/v1/puzzles/count');
}

export function revealSolution(
  sessionId: string,
  source: 'manual' | 'auto' = 'manual'
): Promise<RevealResponse> {
  return requestJson<RevealResponse>('/api/v1/session/reveal', { sessionId, source });
}

export function skipVariation(sessionId: string): Promise<SkipVariationResponse> {
  return requestJson<SkipVariationResponse>('/api/v1/session/skip-variation', { sessionId });
}

export function nextPuzzle(
  sessionId: string,
  mode: VariationMode,
  autoNext: boolean
): Promise<NextResponse> {
  return requestJson<NextResponse>('/api/v1/session/next', { sessionId, mode, autoNext });
}
