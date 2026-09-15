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
import {
  type PlannedFix,
  type QualityFinding,
  type RepairArchive,
  type RepairJournal,
  fingerprintState,
} from "../domain/quality";
import {
  abandonRepairBatch,
  resumeRepairBatch,
  rollbackRepairBatch,
  startRepairBatch,
} from "./repairCoordinator";
import type { WorkspaceState } from "../domain/types";
import { createSampleWorkspaceState } from "./sampleData";
import {
  appendQuarantine,
  bootWorkspace,
  browserStorage,
  clearWorkspaceStorage,
  discardQuarantineEntry as discardQuarantineEntryStorage,
  loadRepairArchive,
  loadWorkspaceEnvelope,
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
  /** 启动自动恢复或人工续跑的结果摘要（供横幅展示）。 */
  recoveryNotice: RecoveryNotice | null;
  /** 启动崩溃安全整批修复（协调器负责逐项落盘与冲突保护）。 */
  runRepairBatch: (
    plans: PlannedFix[],
    expectedFingerprint: string,
  ) => { ok: true } | { ok: false; reason: string };
  resumeRepair: () => void;
  rollbackRepair: () => void;
  abandonRepair: () => void;
  refreshRepairArchive: () => void;
}

export interface RecoveryNotice {
  tone: "success" | "warning" | "info";
  title: string;
  message: string;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const storage: StorageLike = useMemo(() => browserStorage(), []);

  // 引导 + 活动会话自动恢复只在首次挂载时执行一次。
  const initial = useMemo(() => {
    const boot = bootWorkspace(storage);
    let notice: RecoveryNotice | null = null;
    let archive = loadRepairArchive(storage);
    let effectiveState = boot.state;

    if (archive.active) {
      try {
        const result = resumeRepairBatch(storage);
        archive = loadRepairArchive(storage);
        if (result) {
          if (result.phase === "conflict") {
            notice = {
              tone: "warning",
              title: "修复会话与当前数据冲突",
              message: result.detail,
            };
          } else if (
            result.phase === "rollback-resumed" ||
            result.phase === "rollback-completed"
          ) {
            notice = {
              tone: "warning",
              title:
                result.phase === "rollback-resumed"
                  ? "中断的回滚已在启动时完成"
                  : "回滚已在启动时归档",
              message:
                result.phase === "rollback-resumed"
                  ? "检测到已确认的回滚在写入中中断，已恢复到修复前状态，没有重新应用修复。"
                  : result.detail,
            };
          } else if (result.phase === "already-applied") {
            notice = {
              tone: "success",
              title: "修复已生效，已补全会话记录",
              message:
                "检测到修复工作区已保存、会话尚未完成。已只补全会话状态，没有重复执行任何修复。",
            };
          } else if (result.phase === "resumed") {
            notice = {
              tone: "success",
              title: "未完成的整批修复已自动续跑",
              message: result.detail,
            };
          } else if (result.phase === "completed") {
            notice = {
              tone: "success",
              title: "修复会话已归档",
              message: "终态工作区与完成会话一致，活动会话已清除。",
            };
          }
          const envelope = loadWorkspaceEnvelope(storage);
          if (envelope) {
            effectiveState = envelope.state;
          }
          archive = loadRepairArchive(storage);
        }
      } catch (error) {
        notice = {
          tone: "warning",
          title: "修复恢复中断",
          message: error instanceof Error ? error.message : "恢复过程出现异常，会话保留以便重试。",
        };
      }
    }

    return { boot, archive, notice, effectiveState };
  }, [storage]);

  const [state, dispatch] = useReducer(
    workspaceReducer,
    initial.effectiveState,
  );
  const [persistenceReady, setPersistenceReady] = useState(false);
  const [bootFindings, setBootFindings] = useState<QualityFinding[]>(
    initial.boot.findings,
  );
  const [quarantineEntries, setQuarantineEntries] = useState<QuarantineEntry[]>(
    initial.boot.quarantine,
  );
  const [repairArchive, setRepairArchive] = useState<RepairArchive>(
    initial.archive,
  );
  const [recoveryNotice, setRecoveryNotice] = useState<RecoveryNotice | null>(
    initial.notice,
  );
  const dirtyRef = useRef(false);
  // 最近一次确认已经在存储中的工作区指纹。跨标签页 hydrate 与协调器直接写入
  // 都会更新它，自动保存据此跳过“远端更新被本地再写回”的回环保存。
  const persistedFingerprintRef = useRef<string>(
    fingerprintState(initial.effectiveState),
  );

  const dispatchWithTracking = useCallback<Dispatch<WorkspaceAction>>(
    (action) => {
      if (action.type !== "hydrate") {
        dirtyRef.current = true;
      }
      dispatch(action);
    },
    [],
  );

  /**
   * 同步一个“来自存储”的状态（跨标签页同步、协调器直接落盘后对齐）：
   * 更新已持久化指纹、用 hydrate 同步 reducer，且不把它标记为本地脏数据，
   * 因此自动保存不会把同样的内容再写回，避免多窗口反复写回。
   */
  const hydrateFromStorage = useCallback((incoming: WorkspaceState) => {
    persistedFingerprintRef.current = fingerprintState(incoming);
    dirtyRef.current = false;
    dispatch({ type: "hydrate", state: incoming });
  }, []);

  useEffect(() => {
    if (initial.boot.kind === "sample") {
      const seeded = initial.boot.state;
      saveWorkspaceState(seeded, storage);
      persistedFingerprintRef.current = fingerprintState(seeded);
    }
    setPersistenceReady(true);
    // 仅在挂载时执行一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!dirtyRef.current) {
      return;
    }
    // 指纹与存储内容一致时跳过写入（防御任何把存储状态标记为脏的路径）。
    if (fingerprintState(state) === persistedFingerprintRef.current) {
      dirtyRef.current = false;
      return;
    }
    saveWorkspaceState(state, storage);
    persistedFingerprintRef.current = fingerprintState(state);
    dirtyRef.current = false;
  }, [state, storage]);

  const refreshRepairArchive = useCallback(() => {
    setRepairArchive(loadRepairArchive(storage));
  }, [storage]);

  // 跨标签页：其他窗口写入工作区或修复会话后同步本页。
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      // 只关心本应用的命名空间；event.key 为 null（clear）也允许。
      if (
        event.key !== null &&
        !event.key.startsWith("glasshouse-trial-bench:")
      ) {
        return;
      }
      if (
        event.key === null ||
        event.key === "glasshouse-trial-bench:workspace:v1"
      ) {
        const envelope = loadWorkspaceEnvelope(storage);
        if (
          envelope &&
          fingerprintState(envelope.state) !== persistedFingerprintRef.current
        ) {
          hydrateFromStorage(envelope.state);
        }
      }
      setRepairArchive(loadRepairArchive(storage));
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [storage, hydrateFromStorage]);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      state,
      dispatch: dispatchWithTracking,
      persistenceReady,
      bootFindings,
      bootKind: initial.boot.kind,
      quarantineEntries,
      appendQuarantineEntry: (entry) => {
        const next = appendQuarantine(storage, entry);
        setQuarantineEntries(next);
        setBootFindings(quarantineFindings(next));
      },
      discardQuarantineEntry: (id) => {
        const next = discardQuarantineEntryStorage(storage, id);
        setQuarantineEntries(next);
        setBootFindings((current) => {
          const envelope = current.filter(
            (finding) => finding.ruleCode !== "P-QUARANTINE-01",
          );
          return [...envelope, ...quarantineFindings(next)];
        });
      },
      repairArchive,
      activeRepair: repairArchive.active,
      recoveryNotice,
      refreshRepairArchive,
      runRepairBatch: (plans, expectedFingerprint) => {
        try {
          const result = startRepairBatch(storage, plans, {
            expectedFingerprint,
          });
          // 协调器已逐项落盘：对齐内存状态，但不再触发重复写回。
          hydrateFromStorage(result.state);
          setRepairArchive(loadRepairArchive(storage));
          return { ok: true as const };
        } catch (error) {
          setRepairArchive(loadRepairArchive(storage));
          const envelope = loadWorkspaceEnvelope(storage);
          if (envelope) {
            hydrateFromStorage(envelope.state);
          }
          return {
            ok: false as const,
            reason: error instanceof Error ? error.message : "整批修复无法执行",
          };
        }
      },
      resumeRepair: () => {
        const result = resumeRepairBatch(storage);
        setRepairArchive(loadRepairArchive(storage));
        if (!result) {
          return;
        }
        if (result.phase === "conflict") {
          setRecoveryNotice({
            tone: "warning",
            title: "修复会话与当前数据冲突",
            message: result.detail,
          });
          return;
        }
        const envelope = loadWorkspaceEnvelope(storage);
        const workspaceChanged =
          envelope &&
          fingerprintState(envelope.state) !== persistedFingerprintRef.current;
        if (envelope && workspaceChanged) {
          hydrateFromStorage(envelope.state);
        }
        if (
          result.phase === "rollback-resumed" ||
          result.phase === "rollback-completed"
        ) {
          setRecoveryNotice({
            tone: "warning",
            title:
              result.phase === "rollback-resumed"
                ? "中断的回滚已完成"
                : "回滚已归档",
            message:
              result.phase === "rollback-resumed"
                ? "检测到已确认的回滚在写入中中断，已恢复到修复前状态，没有重新应用修复。"
                : result.detail,
          });
          return;
        }
        setRecoveryNotice({
          tone: "success",
          title:
            result.phase === "already-applied"
              ? "修复已生效，会话已补全"
              : result.phase === "completed"
                ? "修复会话已归档"
                : "未完成修复已续跑",
          message: result.detail,
        });
      },
      rollbackRepair: () => {
        rollbackRepairBatch(storage);
        const envelope = loadWorkspaceEnvelope(storage);
        setRepairArchive(loadRepairArchive(storage));
        // 协调器已写回修复前状态：对齐内存，不再触发重复保存。
        if (envelope) {
          hydrateFromStorage(envelope.state);
        }
        setRecoveryNotice({
          tone: "warning",
          title: "已整批回滚",
          message: "工作区恢复到修复会话开始前的状态，审计日志已保留。",
        });
      },
      abandonRepair: () => {
        abandonRepairBatch(storage);
        setRepairArchive(loadRepairArchive(storage));
        setRecoveryNotice({
          tone: "info",
          title: "修复会话已关闭",
          message: "当前数据保持不变，会话记录保留在修复历史中。",
        });
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
      hydrateFromStorage,
      persistenceReady,
      bootFindings,
      initial.boot,
      quarantineEntries,
      repairArchive,
      recoveryNotice,
      storage,
      refreshRepairArchive,
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
