import {
  isObservationSession,
  type ObservationSession,
} from "../domain/observationSession";

export const OBSERVATION_SESSION_STORAGE_KEY =
  "glasshouse-trial-bench:observation-sessions:v1";

interface StoredSessions {
  version: 1;
  savedAt: string;
  sessions: ObservationSession[];
}

export function loadObservationSessions(): ObservationSession[] {
  try {
    const raw = window.localStorage.getItem(OBSERVATION_SESSION_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as Partial<StoredSessions>;
    if (!parsed || !Array.isArray(parsed.sessions)) {
      return [];
    }
    return parsed.sessions.filter(isObservationSession);
  } catch {
    return [];
  }
}

export function findOpenSessionForTrial(
  trialId: string,
): ObservationSession | undefined {
  return loadObservationSessions().find(
    (session) => session.trialId === trialId,
  );
}

export function saveObservationSession(session: ObservationSession): void {
  const rest = loadObservationSessions().filter(
    (item) => item.id !== session.id,
  );
  persistSessions([...rest, session]);
}

export function removeObservationSession(sessionId: string): void {
  persistSessions(
    loadObservationSessions().filter((item) => item.id !== sessionId),
  );
}

export function clearObservationSessionStorage(): void {
  window.localStorage.removeItem(OBSERVATION_SESSION_STORAGE_KEY);
}

function persistSessions(sessions: ObservationSession[]): void {
  const stored: StoredSessions = {
    version: 1,
    savedAt: new Date().toISOString(),
    sessions,
  };
  window.localStorage.setItem(
    OBSERVATION_SESSION_STORAGE_KEY,
    JSON.stringify(stored),
  );
}
