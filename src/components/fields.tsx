import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
}

export function TextField({
  label,
  hint,
  error,
  className = "",
  id,
  ...props
}: FieldProps) {
  const fieldId = id ?? `field-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <label className={`field ${className}`} htmlFor={fieldId}>
      <span className="field-label">{label}</span>
      <input
        id={fieldId}
        className={`field-input ${error ? "field-input-error" : ""}`}
        {...props}
      />
      {hint && !error ? <span className="field-hint">{hint}</span> : null}
      {error ? <span className="field-error">{error}</span> : null}
    </label>
  );
}

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}

export function SelectField({
  label,
  hint,
  error,
  className = "",
  id,
  children,
  ...props
}: SelectFieldProps) {
  const fieldId = id ?? `field-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <label className={`field ${className}`} htmlFor={fieldId}>
      <span className="field-label">{label}</span>
      <select
        id={fieldId}
        className={`field-input ${error ? "field-input-error" : ""}`}
        {...props}
      >
        {children}
      </select>
      {hint && !error ? <span className="field-hint">{hint}</span> : null}
      {error ? <span className="field-error">{error}</span> : null}
    </label>
  );
}

interface TextAreaFieldProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: string;
  error?: string;
}

export function TextAreaField({
  label,
  hint,
  error,
  className = "",
  id,
  ...props
}: TextAreaFieldProps) {
  const fieldId = id ?? `field-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <label className={`field ${className}`} htmlFor={fieldId}>
      <span className="field-label">{label}</span>
      <textarea
        id={fieldId}
        className={`field-input ${error ? "field-input-error" : ""}`}
        {...props}
      />
      {hint && !error ? <span className="field-hint">{hint}</span> : null}
      {error ? <span className="field-error">{error}</span> : null}
    </label>
  );
}
