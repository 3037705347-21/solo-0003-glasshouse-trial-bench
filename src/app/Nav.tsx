import { useRef, useState } from "react";
import {
  ClipboardCheck,
  Download,
  LayoutGrid,
  ListTree,
  NotebookPen,
  Upload,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import { Button } from "../components/Button";
import { Dialog } from "../components/Dialog";
import { ToastRegion, type ToastMessage } from "../components/Toast";
import {
  parseWorkspaceExport,
  serializeWorkspace,
} from "../state/persistence";
import { useWorkspace } from "../state/store";

const navItems = [
  { to: "/roster", label: "材料登记", icon: ListTree },
  { to: "/layout", label: "台架布局", icon: LayoutGrid },
  { to: "/observations", label: "生长观测", icon: NotebookPen },
  { to: "/clearance", label: "试验放行", icon: ClipboardCheck },
];

export function Nav() {
  const { state, dispatch } = useWorkspace();
  const importInputRef = useRef<HTMLInputElement>(null);
  const [pendingImport, setPendingImport] = useState<
    { fileName: string; state: typeof state } | undefined
  >();
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const pushToast = (toast: Omit<ToastMessage, "id">) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((current) => [...current, { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 4200);
  };

  const handleExport = () => {
    const payload = serializeWorkspace(state);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `glasshouse-workspace-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    pushToast({
      tone: "success",
      title: "工作区已导出",
      message: `包含 ${state.attachments.length} 个附件的完整工作区已保存为 JSON 文件。`,
    });
  };

  const handleImportFile = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) {
      return;
    }
    let parsed: ReturnType<typeof parseWorkspaceExport>;
    try {
      parsed = parseWorkspaceExport(await file.text());
    } catch {
      parsed = undefined;
    }
    if (!parsed) {
      pushToast({
        tone: "error",
        title: "导入失败",
        message: "文件不是有效的工作区导出，当前工作区未受影响。",
      });
      return;
    }
    setPendingImport({ fileName: file.name, state: parsed });
  };

  const confirmImport = () => {
    if (!pendingImport) {
      return;
    }
    dispatch({ type: "hydrate", state: pendingImport.state });
    pushToast({
      tone: "success",
      title: "工作区已导入",
      message: `${pendingImport.fileName} 已载入，附件随记录一并恢复。`,
    });
    setPendingImport(undefined);
  };

  return (
    <nav className="side-nav" aria-label="主导航">
      <div className="brand-lockup">
        <span className="brand-mark" aria-hidden="true">
          温试
        </span>
        <span>
          <strong>温室</strong>
          <small>试验台</small>
        </span>
      </div>
      <ul>
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.to}>
              <NavLink
                to={item.to}
                className={({ isActive }) => (isActive ? "nav-link-active" : "")}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
            </li>
          );
        })}
      </ul>
      <div className="side-nav-footer">
        <Button
          tone="ghost"
          size="sm"
          onClick={handleExport}
          data-testid="export-workspace"
        >
          <Download size={15} />
          导出工作区
        </Button>
        <Button
          tone="ghost"
          size="sm"
          onClick={() => importInputRef.current?.click()}
          data-testid="import-workspace"
        >
          <Upload size={15} />
          导入工作区
        </Button>
        <input
          ref={importInputRef}
          type="file"
          accept="application/json,.json"
          className="attachment-file-input"
          data-testid="import-workspace-input"
          aria-label="导入工作区文件"
          onChange={(event) => {
            void handleImportFile(event.target.files);
            event.target.value = "";
          }}
        />
      </div>
      <Dialog
        open={Boolean(pendingImport)}
        title="导入工作区"
        onClose={() => setPendingImport(undefined)}
      >
        {pendingImport ? (
          <div data-testid="confirm-import-workspace">
            <p>
              导入「{pendingImport.fileName}
              」将覆盖当前工作区的全部记录和附件，此操作不可撤销。确定继续吗？
            </p>
            <div className="editor-actions">
              <Button
                tone="secondary"
                onClick={() => setPendingImport(undefined)}
              >
                取消
              </Button>
              <Button
                tone="danger"
                onClick={confirmImport}
                data-testid="confirm-import-workspace-button"
              >
                确认导入
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>
      <ToastRegion
        messages={toasts}
        onDismiss={(id) =>
          setToasts((current) => current.filter((item) => item.id !== id))
        }
      />
    </nav>
  );
}
