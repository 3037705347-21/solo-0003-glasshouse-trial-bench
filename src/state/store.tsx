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
  loadWorkspaceState,
  saveWorkspaceState,
  clearWorkspaceStorage,
  clearPreImportSnapshot,
  loadPreImportSnapshot,
  savePreImportSnapshot,
} from "./persistence";
import { workspaceReducer } from "./reducer";
import type { WorkspaceAction } from "./types";

interface WorkspaceContextValue {
  state: WorkspaceState;
  dispatch: Dispatch<WorkspaceAction>;
  resetWorkspace: () => void;
  clearWorkspace: () => void;
  importWorkspace: (nextState: WorkspaceState) => void;
  restorePreImportSnapshot: () => boolean;
  preImportSavedAt: string | null;
  persistenceReady: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [initialState] = useState<WorkspaceState>(() => loadWorkspaceState());
  const [state, dispatch] = useReducer(workspaceReducer, initialState);
  const [persistenceReady, setPersistenceReady] = useState(false);
  const [preImportSavedAt, setPreImportSavedAt] = useState<string | null>(
    () => loadPreImportSnapshot()?.savedAt ?? null,
  );

  useEffect(() => {
    saveWorkspaceState(state);
    setPersistenceReady(true);
  }, [state]);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      state,
      dispatch,
      persistenceReady,
      preImportSavedAt,
      resetWorkspace: () =>
        dispatch({ type: "reset", state: createSampleWorkspaceState() }),
      clearWorkspace: () => {
        clearWorkspaceStorage();
        clearPreImportSnapshot();
        setPreImportSavedAt(null);
        dispatch({
          type: "reset",
          state: createSampleWorkspaceState(),
        });
      },
      importWorkspace: (nextState: WorkspaceState) => {
        const savedAt = savePreImportSnapshot(state);
        setPreImportSavedAt(savedAt);
        dispatch({ type: "hydrate", state: nextState });
      },
      restorePreImportSnapshot: () => {
        const snapshot = loadPreImportSnapshot();
        if (!snapshot) {
          return false;
        }
        dispatch({ type: "hydrate", state: snapshot.state });
        return true;
      },
    }),
    [state, persistenceReady, preImportSavedAt],
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
