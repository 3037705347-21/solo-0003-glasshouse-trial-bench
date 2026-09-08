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
} from "./persistence";
import { workspaceReducer } from "./reducer";
import type { WorkspaceAction } from "./types";

interface WorkspaceContextValue {
  state: WorkspaceState;
  dispatch: Dispatch<WorkspaceAction>;
  resetWorkspace: () => void;
  clearWorkspace: () => void;
  persistenceReady: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [initialState] = useState<WorkspaceState>(() => loadWorkspaceState());
  const [state, dispatch] = useReducer(workspaceReducer, initialState);
  const [persistenceReady, setPersistenceReady] = useState(false);

  useEffect(() => {
    saveWorkspaceState(state);
    setPersistenceReady(true);
  }, [state]);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      state,
      dispatch,
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
    [state, persistenceReady],
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
