import {
  createContext,
  type Dispatch,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
} from "react";
import type { WorkspaceState } from "../domain/types";
import { createSampleWorkspaceState } from "./sampleData";
import {
  loadAuditLog,
  loadWorkspaceState,
  saveAuditLog,
  saveWorkspaceState,
} from "./persistence";
import { appReducer, type AppState } from "./reducer";
import type { WorkspaceAction } from "./types";

interface WorkspaceContextValue {
  state: WorkspaceState;
  dispatch: Dispatch<WorkspaceAction>;
  audit: AppState["audit"];
  resetWorkspace: () => void;
  importWorkspace: (state: WorkspaceState, label?: string) => void;
  persistenceReady: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [initialState] = useState<AppState>(() => ({
    workspace: loadWorkspaceState(),
    // 审计日志只追加：页面刷新后从独立存储恢复，永不随工作区重置而重写。
    audit: loadAuditLog(),
  }));
  const [appState, dispatch] = useReducer(appReducer, initialState);
  const [persistenceReady, setPersistenceReady] = useState(false);

  useEffect(() => {
    saveWorkspaceState(appState.workspace);
    saveAuditLog(appState.audit);
    setPersistenceReady(true);
  }, [appState]);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      state: appState.workspace,
      audit: appState.audit,
      dispatch,
      persistenceReady,
      resetWorkspace: () =>
        dispatch({
          type: "workspace/replaced",
          state: createSampleWorkspaceState(),
          source: "sample",
        }),
      importWorkspace: (incoming, label) =>
        dispatch({
          type: "workspace/replaced",
          state: incoming,
          source: "import",
          sourceLabel: label,
        }),
    }),
    [appState, persistenceReady],
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
