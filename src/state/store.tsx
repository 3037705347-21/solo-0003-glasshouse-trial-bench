import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
} from "react";
import type { WorkspaceState } from "../domain/types";
import type { Result } from "../domain/result";
import { ok } from "../domain/result";
import {
  reviseObservationPass,
  applyObservationRevision,
  type ObservationRevisionDraft,
  type ObservationRevisionOutcome,
} from "../domain/observation";
import { createSampleWorkspaceState } from "./sampleData";
import {
  WORKSPACE_STORAGE_KEY,
  clearWorkspaceStorage,
  commitWorkspaceTransaction,
  readWorkspaceEnvelope,
  runWorkspaceTask,
  sameWorkspaceState,
  writeWorkspaceEnvelope,
} from "./persistence";
import { workspaceReducer } from "./reducer";
import type { WorkspaceAction } from "./types";

interface WorkspaceContextValue {
  state: WorkspaceState;
  dispatch: Dispatch<WorkspaceAction>;
  /**
   * 观测修订提交：对共享存储的事务（互斥读-校验-写回）。
   * 基于过期版本的提交会被拒绝并返回 stale_base 错误，
   * 已提交的链头不会被整包覆盖。
   */
  commitObservationRevision: (
    basePassId: string,
    draft: ObservationRevisionDraft,
  ) => Promise<Result<ObservationRevisionOutcome>>;
  resetWorkspace: () => void;
  clearWorkspace: () => void;
  persistenceReady: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [initialEnvelope] = useState(() => readWorkspaceEnvelope());
  const [state, dispatch] = useReducer(workspaceReducer, initialEnvelope.state);
  const [persistenceReady, setPersistenceReady] = useState(false);
  /** 本地状态所基于的共享修订号 */
  const baseRevisionRef = useRef(initialEnvelope.revision);
  /** reducer 当前状态，供排队任务识别过期写入 */
  const latestStateRef = useRef(state);
  latestStateRef.current = state;

  // 被动持久化：本地变更排队写入共享存储。若共享修订号已被其他页面
  // 推进且内容出现分叉，则以共享状态为准水合本地，已提交结果不被覆盖。
  useEffect(() => {
    const snapshot = state;
    let cancelled = false;
    runWorkspaceTask(() => {
      if (snapshot !== latestStateRef.current) {
        return { kind: "stale" as const };
      }
      const stored = readWorkspaceEnvelope();
      if (sameWorkspaceState(stored.state, snapshot)) {
        baseRevisionRef.current = stored.revision;
        return { kind: "synced" as const };
      }
      if (stored.revision !== baseRevisionRef.current) {
        return { kind: "diverged" as const, envelope: stored };
      }
      const next = writeWorkspaceEnvelope(snapshot, stored.revision + 1);
      baseRevisionRef.current = next.revision;
      return { kind: "written" as const };
    }).then((result) => {
      if (cancelled) {
        return;
      }
      if (result.kind === "diverged") {
        baseRevisionRef.current = result.envelope.revision;
        dispatch({ type: "hydrate", state: result.envelope.state });
      }
      setPersistenceReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [state]);

  // 其他页面提交后，通过 storage 事件同步最新共享状态。
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== WORKSPACE_STORAGE_KEY) {
        return;
      }
      const envelope = readWorkspaceEnvelope();
      baseRevisionRef.current = envelope.revision;
      dispatch({ type: "hydrate", state: envelope.state });
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const commitObservationRevision = useCallback(
    async (basePassId: string, draft: ObservationRevisionDraft) => {
      const result = await commitWorkspaceTransaction((sharedState) => {
        const outcome = reviseObservationPass(basePassId, draft, sharedState);
        if (!outcome.ok) {
          return outcome;
        }
        return ok({
          state: applyObservationRevision(sharedState, outcome.value),
          value: outcome.value,
        });
      });
      if (result.ok) {
        baseRevisionRef.current = result.value.envelope.revision;
        dispatch({ type: "hydrate", state: result.value.envelope.state });
        return ok(result.value.value);
      }
      return result;
    },
    [],
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      state,
      dispatch,
      commitObservationRevision,
      persistenceReady,
      resetWorkspace: () =>
        dispatch({ type: "reset", state: createSampleWorkspaceState() }),
      clearWorkspace: () => {
        clearWorkspaceStorage();
        dispatch({
          type: "reset",
          state: createSampleWorkspaceState(),
        });
      },
    }),
    [state, persistenceReady, commitObservationRevision],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error("useWorkspace must be used inside WorkspaceProvider");
  }
  return context;
}
