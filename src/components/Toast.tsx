import { CheckCircle2, CircleAlert, Info, X, XCircle } from "lucide-react";
import { Button } from "./Button";

export type ToastTone = "success" | "error" | "info" | "warning";

export interface ToastMessage {
  id: string;
  tone: ToastTone;
  title: string;
  message?: string;
}

const toneIcon = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
  warning: CircleAlert,
};

interface ToastRegionProps {
  messages: ToastMessage[];
  onDismiss: (id: string) => void;
}

export function ToastRegion({ messages, onDismiss }: ToastRegionProps) {
  if (messages.length === 0) {
    return null;
  }
  return (
    <div className="toast-region" aria-live="polite">
      {messages.map((message) => {
        const Icon = toneIcon[message.tone];
        return (
          <div
            className={`toast toast-${message.tone}`}
            key={message.id}
            role="status"
          >
            <Icon className="toast-icon" aria-hidden="true" />
            <div className="toast-copy">
              <strong>{message.title}</strong>
              {message.message ? <p>{message.message}</p> : null}
            </div>
            <Button
              className="icon-button"
              tone="ghost"
              size="sm"
              onClick={() => onDismiss(message.id)}
              aria-label="关闭通知"
            >
              <X size={16} />
            </Button>
          </div>
        );
      })}
    </div>
  );
}
