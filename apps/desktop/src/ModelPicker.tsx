import { useContext, useEffect, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { MotionConfigContext, useReducedMotion } from "motion/react";
import {
  Check,
  ChevronDown,
  Cpu,
  LoaderCircle,
  RefreshCw,
  Search,
} from "lucide-react";
import type { LiveModelOption } from "./live-types";

export function ModelPicker({
  id,
  label,
  value,
  options,
  loading,
  unavailable,
  disabled,
  onChange,
  onRetry,
}: {
  id: string;
  label: string;
  value: string;
  options: LiveModelOption[];
  loading: boolean;
  unavailable: boolean;
  disabled: boolean;
  onChange: (option: LiveModelOption) => void;
  onRetry: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const config = useContext(MotionConfigContext);
  const reduced = useReducedMotion();
  const selected = options.find((m) => m.id === value);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (!disabled) {
          setOpen(next);
          setQuery("");
        }
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          id={id}
          className="model-picker-trigger"
          disabled={disabled}
          aria-label={`${label}: ${selected?.name ?? (value || "Choose a model")}`}
        >
          <span className="model-picker-icon">
            <Cpu size={18} />
          </span>
          <span className="model-picker-value">
            <strong>{selected?.name ?? (value || "Choose a model")}</strong>
            <small>
              {selected
                ? "Change model"
                : loading
                  ? "Loading model list…"
                  : value
                    ? "Saved model ID · not in cached list"
                    : "Select from your Codex catalog"}
            </small>
          </span>
          {loading ? (
            <LoaderCircle size={16} className="model-picker-spinner" />
          ) : (
            <ChevronDown size={17} className="model-picker-chevron" />
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="model-picker-popover"
          sideOffset={8}
          align="start"
          collisionPadding={16}
          aria-label={`Choose ${label.toLowerCase()} model`}
          data-reduced-motion={
            config.reducedMotion === "always" || reduced ? "true" : undefined
          }
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            search.current?.focus();
          }}
        >
          <Command label={`Models for ${label}`} defaultValue={value} loop>
            <div className="model-picker-search">
              <Search size={16} />
              <Command.Input
                ref={search}
                aria-label={`Search models for ${label}`}
                placeholder="Search models…"
                value={query}
                onValueChange={setQuery}
              />
              <kbd>esc</kbd>
            </div>
            <Command.List className="model-picker-list">
              {loading && (
                <p className="model-picker-empty" role="status">
                  Reading your model catalog…
                </p>
              )}
              {!loading && !options.length && (
                <div className="model-picker-empty" role="status">
                  <strong>
                    {unavailable
                      ? "Model list unavailable"
                      : "No compatible models found"}
                  </strong>
                  <p>
                    Open Codex while signed in to update its model catalog, then
                    reload this list.
                  </p>
                </div>
              )}
              {!!options.length && (
                <Command.Empty className="model-picker-empty">
                  No models match “{query}”. Try a different name.
                </Command.Empty>
              )}
              <Command.Group
                heading={options.length ? "CODEX MODELS" : undefined}
              >
                {options.map((option) => (
                  <Command.Item
                    key={option.id}
                    value={option.id}
                    keywords={[option.name, option.description]}
                    onSelect={() => {
                      onChange(option);
                      setOpen(false);
                    }}
                  >
                    <span className="model-picker-option-copy">
                      <strong>{option.name}</strong>
                      <span>{option.description || option.id}</span>
                    </span>
                    {value === option.id && (
                      <Check
                        size={17}
                        className="model-picker-check"
                        aria-label="Currently selected"
                      />
                    )}
                  </Command.Item>
                ))}
              </Command.Group>
            </Command.List>
            <div className="model-picker-footer">
              <span>Local Codex catalog</span>
              <button
                type="button"
                onClick={onRetry}
                disabled={loading}
                aria-label="Reload model list"
              >
                <RefreshCw size={13} /> Reload
              </button>
            </div>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
