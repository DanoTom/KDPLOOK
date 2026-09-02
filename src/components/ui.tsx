import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useEffect } from "react";
import { Icon } from "./icons";

export type Tone = "good" | "warn" | "bad" | "neutral" | "info" | "accent";

// --- buttons -----------------------------------------------------------------

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | "ghost" | "danger";
  size?: "sm" | "md";
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
}

export function Button({
  variant = "default", size = "md", loading, icon, block, children, className = "", disabled, ...rest
}: ButtonProps) {
  const classes = [
    "btn",
    variant === "primary" ? "btn-primary" : variant === "ghost" ? "btn-ghost" : variant === "danger" ? "btn-danger" : "",
    size === "sm" ? "btn-sm" : "",
    block ? "btn-block" : "",
    className,
  ].filter(Boolean).join(" ");

  return (
    <button className={classes} disabled={disabled || loading} {...rest}>
      {loading ? <span className="spinner" /> : icon}
      {children}
    </button>
  );
}

export function IconButton({ label, children, className = "", ...rest }: ButtonProps & { label: string }) {
  return (
    <button className={`btn btn-ghost btn-icon ${className}`} title={label} aria-label={label} {...rest}>
      {children}
    </button>
  );
}

// --- surfaces ----------------------------------------------------------------

export function Card({ children, className = "", pad = false }: { children: ReactNode; className?: string; pad?: boolean }) {
  return <section className={`card ${pad ? "card-pad" : ""} ${className}`}>{children}</section>;
}

export function CardHead({ title, note, children }: { title: ReactNode; note?: ReactNode; children?: ReactNode }) {
  return (
    <header className="card-head">
      <div>
        <h2>{title}</h2>
        {note ? <div className="card-note">{note}</div> : null}
      </div>
      {children ? <div className="spacer row-tight">{children}</div> : null}
    </header>
  );
}

// --- data display ------------------------------------------------------------

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Kpi({
  label, value, sub, tone = "neutral", title,
}: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone; title?: string }) {
  return (
    <div className={`kpi tone-${tone}`} title={title}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub ? <div className="kpi-sub">{sub}</div> : null}
    </div>
  );
}

export function Meter({ value, tone = "neutral" }: { value: number; tone?: Tone }) {
  return (
    <div className={`meter tone-${tone}`}>
      <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Progress({ value, max = 100 }: { value: number; max?: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return <div className="progress"><span style={{ width: `${pct}%` }} /></div>;
}

export function Alert({ tone = "info", children }: { tone?: "good" | "warn" | "bad" | "info"; children: ReactNode }) {
  const glyph = tone === "bad" || tone === "warn" ? <Icon.Alert size={16} /> : <Icon.Info size={16} />;
  return (
    <div className={`alert alert-${tone}`}>
      <span style={{ flex: "none", marginTop: 1, opacity: 0.9 }}>{glyph}</span>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

export function Empty({ icon = "◌", title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      {children ? <div className="small">{children}</div> : null}
    </div>
  );
}

export function Skeleton({ height = 16, width = "100%" }: { height?: number; width?: number | string }) {
  return <div className="skeleton" style={{ height, width }} />;
}

// --- forms -------------------------------------------------------------------

export function Field({
  label, help, children, style,
}: { label?: ReactNode; help?: ReactNode; children: ReactNode; style?: React.CSSProperties }) {
  return (
    <label className="field" style={style}>
      {label ? <span>{label}</span> : null}
      {children}
      {help ? <span className="help">{help}</span> : null}
    </label>
  );
}

export function Switch({
  checked, onChange, label,
}: { checked: boolean; onChange: (value: boolean) => void; label?: ReactNode }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track" />
      {label ? <span className="small">{label}</span> : null}
    </label>
  );
}

export function SegmentedControl<T extends string>({
  value, options, onChange,
}: { value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void }) {
  return (
    <div className="btn-group" role="group">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={option.value === value ? "active" : ""}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({
  value, options, onChange,
}: { value: T; options: Array<{ value: T; label: string; badge?: ReactNode }>; onChange: (value: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          role="tab"
          aria-selected={option.value === value}
          className={`tab ${option.value === value ? "active" : ""}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {option.badge !== undefined ? <span className="nav-badge" style={{ marginLeft: 6 }}>{option.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

// --- overlay -----------------------------------------------------------------

export function Modal({
  title, onClose, children, footer,
}: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <header className="card-head">
          <h2>{title}</h2>
          <div className="spacer">
            <IconButton label="Cerrar" onClick={onClose}><Icon.X size={16} /></IconButton>
          </div>
        </header>
        <div className="card-pad">{children}</div>
        {footer ? <footer className="card-head" style={{ borderBottom: "none", borderTop: "1px solid var(--border)" }}>
          <div className="spacer row-tight">{footer}</div>
        </footer> : null}
      </div>
    </div>
  );
}
