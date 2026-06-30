"use client";

/**
 * Local UI primitives for the Monthly Close tool.
 *
 * OpsCentral's admin dashboard hand-rolls its UI (no shadcn/ui), so this module
 * ships its own small, self-contained primitives styled with the app's semantic
 * Tailwind tokens (--border, --muted, --primary, …). Keeps the page consistent
 * with the rest of the dashboard without introducing a second component system.
 */
import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  useEffect,
} from "react";
import { X } from "lucide-react";

function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// ── Button ───────────────────────────────────────────────────────────────────
type ButtonVariant = "default" | "outline" | "destructive" | "ghost";
type ButtonSize = "default" | "sm";

const buttonVariants: Record<ButtonVariant, string> = {
  default: "bg-primary text-primary-foreground hover:bg-primary/90",
  outline: "border border-border bg-transparent hover:bg-muted text-foreground",
  destructive: "bg-destructive text-white hover:bg-destructive/90",
  ghost: "bg-transparent hover:bg-muted text-foreground",
};
const buttonSizes: Record<ButtonSize, string> = {
  default: "h-9 px-4 text-sm",
  sm: "h-8 px-3 text-xs",
};

export function Button({
  variant = "default",
  size = "default",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...props}
    />
  );
}

// ── Input ────────────────────────────────────────────────────────────────────
export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

// ── Label ────────────────────────────────────────────────────────────────────
export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("text-sm font-medium text-foreground", className)}
      {...props}
    />
  );
}

// ── Native select (styled) ───────────────────────────────────────────────────
export function Select({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

// ── Switch ───────────────────────────────────────────────────────────────────
export function Switch({
  checked,
  onCheckedChange,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
        checked ? "bg-primary" : "bg-muted",
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-4" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

// ── Checkbox ─────────────────────────────────────────────────────────────────
export function Checkbox({
  checked,
  onCheckedChange,
  id,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  id?: string;
}) {
  return (
    <input
      type="checkbox"
      id={id}
      checked={checked}
      onChange={(e) => onCheckedChange(e.target.checked)}
      className="h-4 w-4 rounded border-input accent-primary"
    />
  );
}

// ── Modal ────────────────────────────────────────────────────────────────────
export function Modal({
  open,
  onClose,
  children,
  className,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  labelledBy?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={cn(
          "relative my-8 w-full rounded-lg border border-border bg-background p-5 shadow-xl",
          className ?? "max-w-md",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </button>
        {children}
      </div>
    </div>
  );
}

export function ModalTitle({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h2 id={id} className="text-lg font-semibold text-foreground">
      {children}
    </h2>
  );
}

export function ModalFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("mt-5 flex items-center justify-end gap-2", className)}>{children}</div>
  );
}
