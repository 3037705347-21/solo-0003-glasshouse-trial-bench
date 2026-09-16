import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "./Button";

interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}

export function Dialog({
  open,
  title,
  onClose,
  children,
  footer,
  wide = false,
}: DialogProps) {
  if (!open) {
    return null;
  }
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className={`dialog-panel ${wide ? "dialog-panel-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dialog-header">
          <h2>{title}</h2>
          <Button
            className="icon-button"
            tone="ghost"
            size="sm"
            onClick={onClose}
            aria-label="关闭对话框"
            data-testid="dialog-close"
          >
            <X size={18} />
          </Button>
        </header>
        <div className="dialog-body">{children}</div>
        {footer ? <footer className="dialog-footer">{footer}</footer> : null}
      </section>
    </div>
  );
}
