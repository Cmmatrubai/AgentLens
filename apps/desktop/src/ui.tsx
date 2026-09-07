import { forwardRef, useRef, type ReactNode } from "react";
import { AnimatePresence, motion, type HTMLMotionProps } from "motion/react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Check, Minus, X, CircleAlert } from "lucide-react";
import { type Outcome, outcomeText } from "./data";

export const spring = { type: "spring" as const, stiffness: 400, damping: 34 };
export const Button = forwardRef<
  HTMLButtonElement,
  HTMLMotionProps<"button"> & {
    variant?: "primary" | "secondary" | "ghost";
    small?: boolean;
  }
>(function Button(
  { children, variant = "secondary", small = false, className = "", ...props },
  ref,
) {
  return (
    <motion.button
      ref={ref}
      type="button"
      whileTap={{ scale: 0.98 }}
      className={`button ${variant} ${small ? "small" : ""} ${className}`}
      {...props}
    >
      {children}
    </motion.button>
  );
});
export function IconButton({
  label,
  children,
  ...props
}: HTMLMotionProps<"button"> & { label: string; children: ReactNode }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Button
          className="icon-button"
          variant="ghost"
          aria-label={label}
          {...props}
        >
          {children}
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tooltip" sideOffset={8}>
          {label}
          <Tooltip.Arrow className="tooltip-arrow" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
export function Logo({ small = false }: { small?: boolean }) {
  return (
    <svg
      width={small ? 22 : 28}
      height={small ? 22 : 28}
      viewBox="0 0 28 28"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="m18.5 18.5 6 6M9 12l2 2 4-4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="12"
        cy="12"
        r="12"
        stroke="currentColor"
        strokeOpacity=".15"
      />
    </svg>
  );
}
export function ModelMark({ side }: { side: "a" | "b" }) {
  return (
    <span className={`model-mark ${side}`} aria-hidden="true">
      {side.toUpperCase()}
    </span>
  );
}
export function OutcomeBadge({
  value,
  compact = false,
}: {
  value: Outcome;
  compact?: boolean;
}) {
  const Icon = value === "pass" ? Check : value === "fail" ? X : Minus;
  return (
    <span className={`outcome ${value} ${compact ? "compact" : ""}`}>
      <Icon size={13} />
      {outcomeText(value)}
    </span>
  );
}
export function StateBadge({
  incomplete = false,
  same = false,
}: {
  incomplete?: boolean;
  same?: boolean;
}) {
  return (
    <span className={`state-badge ${incomplete || same ? "neutral" : "amber"}`}>
      {incomplete ? <CircleAlert size={12} /> : <span className="tiny-dot" />}
      {incomplete
        ? "Needs evidence"
        : same
          ? "Same check results"
          : "Difference found"}
    </span>
  );
}
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  className = "",
  drawer = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  drawer?: boolean;
}) {
  const returnFocus = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay forceMount asChild>
              <motion.div
                className="modal-overlay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16 }}
              />
            </Dialog.Overlay>
            <Dialog.Content
              forceMount
              asChild
              onOpenAutoFocus={() => {
                returnFocus.current = document.activeElement as HTMLElement;
              }}
              onCloseAutoFocus={(e) => {
                e.preventDefault();
                // An exiting dialog must not steal focus from a newly opened one.
                if (
                  document.querySelector('[role="dialog"][data-state="open"]')
                )
                  return;
                if (returnFocus.current?.isConnected)
                  returnFocus.current.focus();
              }}
            >
              <motion.section
                className={`${drawer ? "drawer" : "modal"} ${className}`}
                initial={
                  drawer
                    ? { x: 48, opacity: 0 }
                    : { y: 10, scale: 0.98, opacity: 0 }
                }
                animate={
                  drawer ? { x: 0, opacity: 1 } : { y: 0, scale: 1, opacity: 1 }
                }
                exit={
                  drawer
                    ? { x: 36, opacity: 0 }
                    : { y: 8, scale: 0.985, opacity: 0 }
                }
                transition={spring}
              >
                <div className="dialog-heading">
                  <div>
                    <Dialog.Title>{title}</Dialog.Title>
                    <Dialog.Description
                      className={description ? "dialog-description" : "sr-only"}
                    >
                      {description ?? title}
                    </Dialog.Description>
                  </div>
                  <Dialog.Close asChild>
                    <Button
                      variant="ghost"
                      className="icon-button"
                      aria-label="Close dialog"
                    >
                      <X size={18} />
                    </Button>
                  </Dialog.Close>
                </div>
                {children}
              </motion.section>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
export function AnimatedTabs<T extends string>({
  tabs,
  value,
  onChange,
  id,
}: {
  tabs: { id: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  id: string;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          role="tab"
          id={id + "-" + tab.id}
          aria-selected={value === tab.id}
          aria-controls={id + "-panel"}
          tabIndex={value === tab.id ? 0 : -1}
          onClick={() => onChange(tab.id)}
          onKeyDown={(e) => {
            let next: number | undefined;
            if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
            if (e.key === "ArrowLeft")
              next = (index + tabs.length - 1) % tabs.length;
            if (e.key === "Home") next = 0;
            if (e.key === "End") next = tabs.length - 1;
            if (next !== undefined) {
              e.preventDefault();
              onChange(tabs[next].id);
              document.getElementById(id + "-" + tabs[next].id)?.focus();
            }
          }}
          className={value === tab.id ? "active" : ""}
        >
          <span>{tab.label}</span>
          {tab.count !== undefined && (
            <span className="tab-count">{tab.count}</span>
          )}
          {value === tab.id && (
            <motion.span
              className="tab-underline"
              layoutId={id + "-underline"}
              transition={spring}
            />
          )}
        </button>
      ))}
    </div>
  );
}
