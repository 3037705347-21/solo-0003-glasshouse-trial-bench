import { Redo2, Undo2 } from "lucide-react";
import { useWorkspace } from "../state/store";

export function HistoryControls() {
  const {
    canUndo,
    canRedo,
    undo,
    redo,
    undoLabel,
    redoLabel,
    historyError,
    clearHistoryError,
  } = useWorkspace();

  return (
    <div className="history-controls" data-testid="history-controls">
      <div className="history-buttons">
        <button
          type="button"
          className="history-button"
          onClick={undo}
          disabled={!canUndo}
          title={undoLabel ? `撤销：${undoLabel}` : "暂无可撤销操作"}
          data-testid="undo-button"
        >
          <Undo2 size={15} aria-hidden="true" />
          <span>撤销</span>
        </button>
        <button
          type="button"
          className="history-button"
          onClick={redo}
          disabled={!canRedo}
          title={redoLabel ? `重做：${redoLabel}` : "暂无可重做操作"}
          data-testid="redo-button"
        >
          <Redo2 size={15} aria-hidden="true" />
          <span>重做</span>
        </button>
      </div>
      {historyError ? (
        <button
          type="button"
          className="history-error"
          onClick={clearHistoryError}
          title="点击关闭提示"
          aria-live="polite"
          data-testid="history-error"
        >
          {historyError}
        </button>
      ) : null}
    </div>
  );
}
