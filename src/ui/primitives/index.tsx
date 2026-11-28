import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { UiIcon } from './icons';
import primitivesCss from './primitives.css?inline';

export type { BrandMarkProps } from './brand-mark';
export type { BrandWordmarkProps } from './brand-wordmark';
export type { UiIconName } from './icons';
export type { DraggableResult, DragHandleProps, DragOffset } from './use-draggable';
export { BrandMark } from './brand-mark';
export { BrandWordmark } from './brand-wordmark';
export { UiIcon } from './icons';
export { useDraggable } from './use-draggable';
export { primitivesCss };

const SITE_MARKS: Readonly<Record<string, string>> = {
  facebook: 'f',
  x: '𝕏',
  instagram: 'IG',
  reddit: 'r/',
  gmail: 'M',
};

/** Compact 1–2 character monogram badge for a supported host site. */
export function getSiteMark(siteId: string, displayName: string): string {
  return SITE_MARKS[siteId] ?? displayName.slice(0, 2).toUpperCase();
}

/** Shared mouseleave + focus-leaving props that clear a live hover/focus preview cleanly. */
export function previewLeaveProps(onClear: () => void) {
  return {
    onMouseLeave: onClear,
    onBlur: (event: { currentTarget: HTMLElement; relatedTarget: EventTarget | null }) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        onClear();
      }
    },
  };
}

export interface SwitchProps {
  readonly id?: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly ariaLabel?: string;
  readonly ariaDescribedBy?: string;
  readonly onChange: (checked: boolean) => void;
}

export interface TextInputProps {
  readonly id?: string;
  readonly className?: string;
  readonly type?: 'text' | 'number' | 'search' | 'url';
  readonly inputMode?: 'text' | 'url' | 'numeric' | 'decimal' | 'search';
  readonly value: string;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly spellCheck?: boolean;
  readonly ariaLabel?: string;
  readonly ariaDescribedBy?: string;
  readonly ariaInvalid?: boolean;
  /** Focuses the input and selects its text once when it mounts (inline rename/save forms). */
  readonly selectOnMount?: boolean;
  readonly onValueChange: (value: string) => void;
  readonly onBlur?: (event: {
    currentTarget: HTMLInputElement;
    relatedTarget: EventTarget | null;
  }) => void;
  readonly onKeyDown?: (event: {
    key: string;
    currentTarget: HTMLInputElement;
    preventDefault: () => void;
    stopPropagation: () => void;
  }) => void;
}

/**
 * Controlled text/number/url input normalized for `preact/compat` so keystrokes
 * always fire `onValueChange` immediately regardless of `type` (`url`, `search`, etc.).
 */
export function TextInput({
  id,
  className = 'field',
  type = 'text',
  inputMode,
  value,
  placeholder,
  disabled,
  spellCheck,
  ariaLabel,
  ariaDescribedBy,
  ariaInvalid,
  selectOnMount,
  onValueChange,
  onBlur,
  onKeyDown,
}: TextInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectOnMount) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [selectOnMount]);
  const effectiveType = type === 'url' ? 'text' : type;
  const effectiveMode = inputMode ?? (type === 'url' ? 'url' : undefined);
  return (
    <input
      ref={inputRef}
      id={id}
      className={className}
      type={effectiveType}
      inputMode={effectiveMode}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      spellCheck={spellCheck}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      aria-invalid={ariaInvalid || undefined}
      onInput={(event) => onValueChange(event.currentTarget.value)}
      onChange={(event) => onValueChange(event.currentTarget.value)}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
    />
  );
}

/** Tactile pill switch backed by a native `<input type="checkbox">`. */
export function Switch({
  id,
  checked,
  disabled,
  ariaLabel,
  ariaDescribedBy,
  onChange,
}: SwitchProps) {
  return (
    <span className="fs-switch">
      <input
        id={id}
        className="fs-switch-input"
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
    </span>
  );
}

export interface SettingCardProps {
  readonly title?: string;
  readonly action?: ReactNode;
  readonly jumpId?: string;
  readonly children: ReactNode;
}

/** Grouped card container with an optional uppercase section kicker. */
export function SettingCard({ title, action, jumpId, children }: SettingCardProps) {
  return (
    <div className="fs-card-wrap" data-fs-jump-id={jumpId}>
      {(title || action) && (
        <div className="fs-kicker-row">
          {title && <h4 className="fs-kicker">{title}</h4>}
          {action}
        </div>
      )}
      <div className="fs-card">{children}</div>
    </div>
  );
}

export interface SettingRowProps {
  readonly title: string;
  readonly description?: string;
  readonly hint?: string;
  readonly htmlFor?: string;
  readonly descriptionId?: string;
  readonly jumpId?: string;
  readonly stacked?: boolean;
  readonly dimmed?: boolean;
  readonly nested?: boolean;
  readonly pulse?: boolean;
  readonly children: ReactNode;
}

/** Scrolls `el` to the vertical center of its scroll container, respecting reduced motion. */
export function scrollIntoViewCentered(el: Element | null | undefined): void {
  if (!el) {
    return;
  }
  const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView?.({
    block: 'center',
    behavior: reducedMotion ? 'auto' : 'smooth',
  });
}

/** Triggers a browser download of `text` as a UTF-8 JSON file and revokes its object URL. */
export function downloadJsonFile(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    globalThis.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export function SettingRow({
  title,
  description,
  hint,
  htmlFor,
  descriptionId,
  jumpId,
  stacked = false,
  dimmed = false,
  nested = false,
  pulse = false,
  children,
}: SettingRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (pulse) {
      scrollIntoViewCentered(rowRef.current);
    }
  }, [pulse]);

  const classes = ['fs-row'];
  if (stacked) {
    classes.push('fs-stacked');
  }
  if (dimmed) {
    classes.push('fs-dimmed');
  }
  if (nested) {
    classes.push('fs-nested');
  }
  if (pulse) {
    classes.push('fs-pulse');
  }

  const clickable = Boolean(htmlFor && !dimmed && !stacked);

  const handleTextClick = (event: { target: EventTarget | null; currentTarget: HTMLElement }) => {
    if (!htmlFor) {
      return;
    }
    const target = event.target as HTMLElement | null;
    // Skip if the user already clicked the native <label> (which toggles/focuses automatically)
    // or drag-selected text inside the description.
    if (target?.closest('label, a, button, input, select, textarea')) {
      return;
    }
    const root = event.currentTarget.getRootNode();
    const sel =
      (root && 'getSelection' in root
        ? (root as ShadowRoot & { getSelection?: () => Selection | null }).getSelection?.()
        : null) ?? globalThis.getSelection?.();
    if (sel && !sel.isCollapsed && sel.toString().length > 0) {
      return;
    }
    const control = Array.from(rowRef.current?.querySelectorAll('[id]') ?? []).find(
      (el) => el.id === htmlFor,
    );
    if (control instanceof HTMLInputElement && control.type === 'checkbox') {
      control.click();
    } else if (control instanceof HTMLElement) {
      control.focus();
    }
  };

  return (
    <div ref={rowRef} className={classes.join(' ')} data-fs-jump-id={jumpId}>
      <div
        className={clickable ? 'fs-row-text fs-row-clickable' : 'fs-row-text'}
        onClick={clickable ? handleTextClick : undefined}
      >
        <div className="fs-row-title-line">
          {htmlFor ? (
            <label className="fs-row-title" htmlFor={htmlFor}>
              {title}
            </label>
          ) : (
            <span className="fs-row-title">{title}</span>
          )}
          {hint && <span className="fs-row-hint">{hint}</span>}
        </div>
        {description && (
          <p className="fs-row-desc" id={descriptionId}>
            {description}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

export interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

export interface SegmentedControlProps<T extends string> {
  readonly options: readonly SegmentedOption<T>[];
  readonly value: T | null;
  readonly armedValue?: T | null;
  readonly ariaLabel: string;
  readonly fullWidth?: boolean;
  readonly onChange: (value: T) => void;
}

const MAX_SEGMENTS_PER_ROW = 7;

export function SegmentedControl<T extends string>({
  options,
  value,
  armedValue,
  ariaLabel,
  fullWidth = false,
  onChange,
}: SegmentedControlProps<T>) {
  // A long full-width row (eight click effects) splits into two even rows before its labels truncate.
  const columns =
    options.length > MAX_SEGMENTS_PER_ROW ? Math.ceil(options.length / 2) : options.length;
  return (
    <div
      className={fullWidth ? 'fs-segmented fs-segmented-full' : 'fs-segmented'}
      style={fullWidth ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className="fs-segmented-btn"
          title={opt.label}
          aria-pressed={value === opt.value}
          data-armed={armedValue === opt.value ? 'true' : undefined}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export interface BadgeProps {
  readonly tone?: 'neutral' | 'accent' | 'success' | 'warning';
  readonly children: ReactNode;
}

export function Badge({ tone = 'neutral', children }: BadgeProps) {
  return (
    <span className="fs-badge" data-tone={tone}>
      {children}
    </span>
  );
}

export interface DisclosureProps {
  readonly label: string;
  readonly badge?: ReactNode;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly jumpId?: string;
  readonly children: ReactNode;
}

export function Disclosure({ label, badge, open, onToggle, jumpId, children }: DisclosureProps) {
  return (
    <>
      <button
        type="button"
        className="fs-disclosure-trigger"
        data-fs-jump-id={jumpId}
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="fs-disclosure-label">
          <span>{label}</span>
          {badge}
        </span>
        <UiIcon name="chevronRight" size={14} className="fs-disclosure-chev" />
      </button>
      {open && <div className="fs-disclosure-body">{children}</div>}
    </>
  );
}

export interface ToastState {
  readonly message: string;
  readonly onUndo?: () => void;
}

/** Shared auto-dismissing toast controller with clean Undo dismissal and unmount teardown. */
export function useToast(durationMs = 4000) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const dismiss = useCallback(() => {
    if (timerRef.current !== undefined) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    setToast(null);
  }, []);

  const notify = useCallback(
    (message: string, onUndo?: () => void) => {
      if (timerRef.current !== undefined) {
        clearTimeout(timerRef.current);
      }
      setToast(
        onUndo
          ? {
              message,
              onUndo: () => {
                dismiss();
                onUndo();
              },
            }
          : { message },
      );
      timerRef.current = setTimeout(() => {
        timerRef.current = undefined;
        setToast(null);
      }, durationMs);
    },
    [dismiss, durationMs],
  );

  useEffect(() => dismiss, [dismiss]);

  return { toast, notify, dismiss };
}

export interface ToastProps {
  readonly message: string;
  readonly onUndo?: () => void;
}

export function Toast({ message, onUndo }: ToastProps) {
  return (
    <div className="fs-toast" role="status" aria-live="polite">
      <span className="fs-toast-message">{message}</span>
      {onUndo && (
        <button type="button" className="fs-toast-undo" onClick={onUndo}>
          Undo
        </button>
      )}
    </div>
  );
}
