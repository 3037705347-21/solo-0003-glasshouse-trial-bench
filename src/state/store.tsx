import {
  createContext,
  type Dispatch,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type { WorkspaceState } from "../domain/types";
import { createSampleWorkspaceState } from "./sampleData";
import {
  clearWorkspaceStorage,
  exportRawWorkspace,
  loadWorkspace,
  resetToSample,
  restoreFromBackup,
  saveWorkspace,
} from "./persistence";
import { workspaceReducer } from "./reducer";
import type { MigrationIssue, MigrationStepRecord } from "./migration/types";
import { isDanglingReferenceIssue } from "./migration/types";
import {
  acknowledgeUnknownField,
  keepDanglingAsIs,
  resolveDanglingByClear,
  resolveDanglingByRelink,
  resolveUnknownEnum,
} from "./migration/resolution";

export interface RecoveryInfo {
  reasonCode: string;
  message: string;
  raw: unknown;
  hasBackup: boolean;
}

interface WorkspaceContextValue {
  state: WorkspaceState;
  dispatch: Dispatch<import("./types").WorkspaceAction>;
  resetWorkspace: () => void;
  clearWorkspace: () => void;
  persistenceReady: boolean;

  /** 升级后仍待人工处理的问题（打开/已知悉）。 */
  issues: MigrationIssue[];
  openIssues: MigrationIssue[];
  resolveIssue: {
    relink: (issueId: string, newRef: string) => void;
    clear: (issueId: string) => void;
    keep: (issueId: string, note: string) => void;
    fixEnum: (issueId: string, newValue: string) => void;
    acknowledgeField: (issueId: string) => void;
  };

  /** 恢复模式：升级失败/写入失败，写入被锁定，必须人工介入。 */
  recovery: RecoveryInfo | null;
  exportRaw: () => void;
  rollbackBackup: () => void;
  confirmResetAfterRecovery: () => void;

  /** 最近一次日常保存是否失败（失败不得伪装成成功）。 */
  saveError: string | null;
  /** 本次启动是否自动完成了一次无损升级。 */
  upgradedFromVersion: boolean;
  isSampleWorkspace: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

interface Bootstrap {
  state: WorkspaceState;
  issues: MigrationIssue[];
  history: MigrationStepRecord[];
  recovery: RecoveryInfo | null;
  upgraded: boolean;
  isSample: boolean;
}

function bootstrapWorkspace(): Bootstrap {
  const outcome = loadWorkspace({ createSample: createSampleWorkspaceState });
  if (outcome.kind === "empty") {
    return {
      state: outcome.state,
      issues: [],
      history: [],
      recovery: null,
      upgraded: false,
      isSample: true,
    };
  }
  if (outcome.kind === "ready") {
    return {
      state: outcome.state,
      issues: outcome.issues,
      history: outcome.history,
      recovery: null,
      upgraded: outcome.upgraded,
      isSample: false,
    };
  }
  // recovery：不放任何业务数据到可写状态。state 仅用于错误页渲染骨架，
  // 且写入被锁定，绝不可能把示例数据保存覆盖旧工作区。
  return {
    state: createSampleWorkspaceState(),
    issues: [],
    history: [],
    recovery: {
      reasonCode: outcome.reasonCode,
      message: outcome.message,
      raw: outcome.raw,
      hasBackup: outcome.hasBackup,
    },
    upgraded: false,
    isSample: true,
  };
}

function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [boot] = useState<Bootstrap>(bootstrapWorkspace);
  const [state, dispatch] = useReducer(workspaceReducer, boot.state);
  const [issues, setIssues] = useState<MigrationIssue[]>(boot.issues);
  const [history] = useState<MigrationStepRecord[]>(boot.history);
  const [recovery, setRecovery] = useState<RecoveryInfo | null>(boot.recovery);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [upgraded] = useState(boot.upgraded);
  const [isSample, setIsSample] = useState(boot.isSample);
  const [persistenceReady, setPersistenceReady] = useState(false);

  // 恢复模式下全局写锁定；用 ref 让持久化 effect 总能读到最新锁定状态。
  const locked = useRef(recovery !== null);
  locked.current = recovery !== null;

  useEffect(() => {
    if (locked.current) {
      // 恢复模式绝不自动保存，避免骨架/示例态覆盖旧工作区。
      return;
    }
    const result = saveWorkspace(state, issues, history);
    setPersistenceReady(true);
    setSaveError(result.ok ? null : (result.message ?? "保存失败"));
  }, [state, issues, history]);

  const applyResolution = (issueId: string, next: ReturnType<typeof resolveDanglingByRelink>): void => {
    dispatch({ type: "hydrate", state: next.state });
    setIssues(next.issues);
  };

  const value = useMemo<WorkspaceContextValue>(() => {
    const findIssue = (issueId: string): MigrationIssue | undefined =>
      issues.find((issue) => issue.id === issueId);

    return {
      state,
      dispatch,
      issues,
      openIssues: issues.filter((issue) => issue.status === "open"),
      persistenceReady,
      saveError,
      recovery,
      upgradedFromVersion: upgraded,
      isSampleWorkspace: isSample,
      resolveIssue: {
        relink: (issueId, newRef) => {
          const issue = findIssue(issueId);
          if (issue && isDanglingReferenceIssue(issue)) {
            applyResolution(
              issueId,
              resolveDanglingByRelink(state, issues, issue, newRef),
            );
          }
        },
        clear: (issueId) => {
          const issue = findIssue(issueId);
          if (issue && isDanglingReferenceIssue(issue)) {
            applyResolution(
              issueId,
              resolveDanglingByClear(state, issues, issue),
            );
          }
        },
        keep: (issueId, note) => {
          const issue = findIssue(issueId);
          if (issue && isDanglingReferenceIssue(issue)) {
            applyResolution(
              issueId,
              keepDanglingAsIs(state, issues, issue, note),
            );
          }
        },
        fixEnum: (issueId, newValue) => {
          const issue = findIssue(issueId);
          if (issue?.code === "unknown_enum_value") {
            applyResolution(
              issueId,
              resolveUnknownEnum(state, issues, issue, newValue),
            );
          }
        },
        acknowledgeField: (issueId) => {
          const issue = findIssue(issueId);
          if (issue?.code === "unknown_field") {
            applyResolution(
              issueId,
              acknowledgeUnknownField(state, issues, issue),
            );
          }
        },
      },
      exportRaw: () => {
        const raw = exportRawWorkspace();
        downloadText(
          `glasshouse-workspace-recovery-${Date.now()}.json`,
          raw ??
            JSON.stringify(recovery?.raw, null, 2) ??
            "",
        );
      },
      rollbackBackup: () => {
        const result = restoreFromBackup();
        if (result.ok) {
          window.location.reload();
        } else {
          setSaveError(result.message ?? "回滚失败");
        }
      },
      confirmResetAfterRecovery: () => {
        const sample = resetToSample(createSampleWorkspaceState);
        setRecovery(null);
        setIsSample(true);
        dispatch({ type: "reset", state: sample });
        window.location.reload();
      },
      resetWorkspace: () => {
        const sample = resetToSample(createSampleWorkspaceState);
        setIsSample(true);
        dispatch({ type: "reset", state: sample });
      },
      clearWorkspace: () => {
        clearWorkspaceStorage();
        const sample = resetToSample(createSampleWorkspaceState);
        setIsSample(true);
        dispatch({ type: "reset", state: sample });
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, issues, recovery, saveError, persistenceReady, upgraded, isSample]);

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
