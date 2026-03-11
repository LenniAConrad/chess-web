import type {
  SessionHistoryClearResponse,
  HintResponse,
  MoveResponse,
  NextResponse,
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

export function startSession(
  mode: VariationMode,
  autoNext: boolean,
  puzzleId?: string,
  source: 'normal' | 'history' = 'normal'
): Promise<StartSessionResponse> {
  return requestJson<StartSessionResponse>('/api/v1/session/start', { mode, autoNext, puzzleId, source });
}

export function playMove(sessionId: string, uciMove: string): Promise<MoveResponse> {
  return requestJson<MoveResponse>('/api/v1/session/move', { sessionId, uciMove });
}

export function loadSession(sessionId: string): Promise<StartSessionResponse> {
  return requestJson<StartSessionResponse>('/api/v1/session/load', { sessionId });
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
