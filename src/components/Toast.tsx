import { useState } from "react";
import { CheckCircle2, CircleAlert, Info, X, XCircle } from "lucide-react";
import { Button } from "./Button";

export type ToastTone = "success" | "error" | "info" | "warning";

export interface ToastMessage {
  id: string;
  tone: ToastTone;
  title: string;
  message?: string;
}

export function useToastQueue() {
  const [messages, setMessages] = useState<ToastMessage[]>([]);

  const pushToast = (toast: Omit<ToastMessage, "id">) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setMessages((current) => [...current, { ...toast, id }]);
    window.setTimeout(() => {
      setMessages((current) => current.filter((item) => item.id !== id));
    }, 4200);
  };

  const dismissToast = (id: string) => {
    setMessages((current) => current.filter((item) => item.id !== id));
  };

  return { messages, pushToast, dismissToast };
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
