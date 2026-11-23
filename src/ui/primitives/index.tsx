import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { UiIcon } from './icons';
import primitivesCss from './primitives.css?inline';

export type { UiIconName } from './icons';
export { UiIcon } from './icons';
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

export interface SwitchProps {
  readonly id?: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly ariaLabel?: string;
  readonly ariaDescribedBy?: string;
  readonly onChange: (checked: boolean) => void;
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
  readonly children: ReactNode;
}

/** Grouped card container with an optional uppercase section kicker. */
export function SettingCard({ title, action, children }: SettingCardProps) {
  return (
    <div className="fs-card-wrap">
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
  readonly htmlFor?: string;
  readonly descriptionId?: string;
  readonly stacked?: boolean;
  readonly dimmed?: boolean;
  readonly pulse?: boolean;
  readonly children: ReactNode;
}

export function SettingRow({
  title,
  description,
  htmlFor,
  descriptionId,
  stacked = false,
  dimmed = false,
  pulse = false,
  children,
}: SettingRowProps) {
  const classes = ['fs-row'];
  if (stacked) {
    classes.push('fs-stacked');
  }
  if (dimmed) {
    classes.push('fs-dimmed');
  }
  if (pulse) {
    classes.push('fs-pulse');
  }
  return (
    <div className={classes.join(' ')}>
      <div className="fs-row-text">
        {htmlFor ? (
          <label className="fs-row-title" htmlFor={htmlFor}>
            {title}
          </label>
        ) : (
          <span className="fs-row-title">{title}</span>
        )}
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
  readonly ariaLabel: string;
  readonly fullWidth?: boolean;
  readonly onChange: (value: T) => void;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  ariaLabel,
  fullWidth = false,
  onChange,
}: SegmentedControlProps<T>) {
  return (
    <div
      className={fullWidth ? 'fs-segmented fs-segmented-full' : 'fs-segmented'}
      style={
        fullWidth ? { gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` } : undefined
      }
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className="fs-segmented-btn"
          aria-pressed={value === opt.value}
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
  readonly children: ReactNode;
}

export function Disclosure({ label, badge, open, onToggle, children }: DisclosureProps) {
  return (
    <>
      <button
        type="button"
        className="fs-disclosure-trigger"
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
      <span>{message}</span>
      {onUndo && (
        <button type="button" className="fs-toast-undo" onClick={onUndo}>
          Undo
        </button>
      )}
    </div>
  );
}
