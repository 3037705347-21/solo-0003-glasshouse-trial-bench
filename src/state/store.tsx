import {
  createContext,
  type Dispatch,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type { QualityFinding, RepairArchive, RepairJournal } from "../domain/quality";
import type { WorkspaceState } from "../domain/types";
import { createSampleWorkspaceState } from "./sampleData";
import {
  appendQuarantine,
  bootWorkspace,
  browserStorage,
  clearWorkspaceStorage,
  discardQuarantineEntry as discardQuarantineEntryStorage,
  loadRepairArchive,
  quarantineFindings,
  saveRepairArchive,
  saveWorkspaceState,
  type QuarantineEntry,
  type StorageLike,
} from "./persistence";
import { workspaceReducer } from "./reducer";
import type { WorkspaceAction } from "./types";

interface WorkspaceContextValue {
  state: WorkspaceState;
  dispatch: Dispatch<WorkspaceAction>;
  resetWorkspace: () => void;
  clearWorkspace: () => void;
  persistenceReady: boolean;
  /** 启动引导阶段发现的持久化问题（版本、封装、隔离区）。 */
  bootFindings: QualityFinding[];
  bootKind: "sample" | "loaded" | "empty";
  quarantineEntries: QuarantineEntry[];
  appendQuarantineEntry: (entry: QuarantineEntry) => void;
  discardQuarantineEntry: (id: string) => void;
  repairArchive: RepairArchive;
  activeRepair: RepairJournal | null;
  saveActiveRepair: (journal: RepairJournal) => void;
  finishRepair: (journal: RepairJournal) => void;
  applyRepairedState: (state: WorkspaceState) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const storage: StorageLike = useMemo(() => browserStorage(), []);
  const [boot] = useState(() => bootWorkspace(storage));
  const [state, dispatch] = useReducer(workspaceReducer, boot.state);
  const [persistenceReady, setPersistenceReady] = useState(false);
  const [bootFindings, setBootFindings] = useState<QualityFinding[]>(
    boot.findings,
  );
  const [quarantineEntries, setQuarantineEntries] = useState<QuarantineEntry[]>(
    boot.quarantine,
  );
  const [repairArchive, setRepairArchive] = useState<RepairArchive>(() =>
    loadRepairArchive(storage),
  );
  // 只在工作区发生过显式变更后才持久化。损坏隔离后的空工作区不得自动写回，
  // 避免覆盖损坏内容；但首次使用（无存储）需要把示例工作区固化一次。
  const dirtyRef = useRef(false);

  // 每次 dispatch 经过 reducer 后标记脏；"hydrate" 只是同步外部状态，不算用户变更。
  const dispatchWithTracking = useCallback<Dispatch<WorkspaceAction>>((action) => {
    if (action.type !== "hydrate") {
      dirtyRef.current = true;
    }
    dispatch(action);
  }, []);

  useEffect(() => {
    // 首次启动：存储为空，示例工作区来自内存，显式播种一次。
    if (boot.kind === "sample") {
      saveWorkspaceState(boot.state, storage);
    }
    setPersistenceReady(true);
    // 仅在挂载时执行一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!dirtyRef.current) {
      return;
    }
    saveWorkspaceState(state, storage);
  }, [state, storage]);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      state,
      dispatch: dispatchWithTracking,
      persistenceReady,
      bootFindings,
      bootKind: boot.kind,
      quarantineEntries,
      appendQuarantineEntry: (entry) => {
        const next = appendQuarantine(storage, entry);
        setQuarantineEntries(next);
        setBootFindings(quarantineFindings(next));
      },
      discardQuarantineEntry: (id) => {
        const next = discardQuarantineEntryStorage(storage, id);
        setQuarantineEntries(next);
        // 隔离区发现随记录清除而消解；非隔离区的引导提示（如封装缺时间戳）保留。
        setBootFindings((current) => {
          const envelope = current.filter(
            (finding) => finding.ruleCode !== "P-QUARANTINE-01",
          );
          return [...envelope, ...quarantineFindings(next)];
        });
      },
      repairArchive,
      activeRepair: repairArchive.active,
      saveActiveRepair: (journal: RepairJournal) => {
        const current = loadRepairArchive(storage);
        const nextArchive: RepairArchive = { ...current, active: journal };
        saveRepairArchive(storage, nextArchive);
        setRepairArchive(nextArchive);
      },
      finishRepair: (journal: RepairJournal) => {
        const current = loadRepairArchive(storage);
        const history = [
          journal,
          ...current.history.filter((item) => item.id !== journal.id),
        ].slice(0, 20);
        const nextArchive: RepairArchive = { active: null, history };
        saveRepairArchive(storage, nextArchive);
        setRepairArchive(nextArchive);
      },
      applyRepairedState: (repaired: WorkspaceState) => {
        // 先同步持久化最终状态，避免同一批处理中归档写入触发的 context 重算
        // 让自动保存 effect 用旧状态覆盖修复结果。
        dirtyRef.current = true;
        saveWorkspaceState(repaired, storage);
        dispatch({ type: "quality/repaired", state: repaired });
      },
      resetWorkspace: () =>
        dispatch({ type: "reset", state: createSampleWorkspaceState() }),
      clearWorkspace: () => {
        clearWorkspaceStorage(storage);
        dispatch({
          type: "reset",
          state: createSampleWorkspaceState(),
        });
      },
    }),
    [
      state,
      dispatchWithTracking,
      persistenceReady,
      bootFindings,
      boot.kind,
      quarantineEntries,
      repairArchive,
      storage,
    ],
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
