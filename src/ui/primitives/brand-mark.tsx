import { useId, useMemo } from 'react';

export interface BrandMarkProps {
  /** Pixel width and height of the borderless Moonglade glyph (small cut, designed for 14–48px). */
  readonly size?: number;
  readonly className?: string;
  /** Accessible label; when omitted, the mark is decorative (`aria-hidden="true"`). */
  readonly label?: string;
}

const SVG_STYLE = { display: 'block', flex: 'none' } as const;
const MOON_START_STYLE = { stopColor: 'var(--fs-brand-moon-start, #fffcee)' } as const;
const MOON_END_STYLE = { stopColor: 'var(--fs-brand-tittle, #ffdc98)' } as const;
const WAKE_START_STYLE = { stopColor: 'var(--fs-brand-wake-start, #b9fff1)' } as const;
const WAKE_MID_STYLE = { stopColor: 'var(--fs-brand-wake-mid, #5be9e0)' } as const;
const WAKE_END_STYLE = { stopColor: 'var(--fs-brand-wake-end, #22aeea)' } as const;

/**
 * Borderless Feed Sanity Moonglade small-cut glyph (moon + water wake, no badge tile or rim).
 * Pure JSX SVG (100% Trusted Types safe) with `useId()`-scoped `<defs>` IDs so multiple marks
 * in the same document or ShadowRoot never collide, and CSS-token gradient stops that adapt
 * automatically between light (Daybreak) and dark (Night Edition) surfaces.
 */
export function BrandMark({ size = 28, className, label }: BrandMarkProps) {
  const uid = useId();
  const artwork = useMemo(() => {
    const moonId = `${uid}-moon`;
    const wakeId = `${uid}-wake`;

    return (
      <>
        <defs>
          <linearGradient
            id={moonId}
            x1="50"
            y1="8.333"
            x2="78"
            y2="45.667"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" style={MOON_START_STYLE} />
            <stop offset="1" style={MOON_END_STYLE} />
          </linearGradient>
          <linearGradient
            id={wakeId}
            x1="64"
            y1="56"
            x2="64"
            y2="120"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" style={WAKE_START_STYLE} />
            <stop offset="0.5" style={WAKE_MID_STYLE} />
            <stop offset="1" style={WAKE_END_STYLE} />
          </linearGradient>
        </defs>
        <circle cx="64" cy="27" r="21" fill={`url(#${moonId})`} />
        <g fill={`url(#${wakeId})`}>
          <rect x="16" y="56" width="96" height="16" rx="8" />
          <rect x="32" y="80" width="64" height="16" rx="8" />
          <rect x="48" y="104" width="32" height="16" rx="8" />
        </g>
      </>
    );
  }, [uid]);

  return (
    <svg
      className={className ? `fs-brand-mark ${className}` : 'fs-brand-mark'}
      width={size}
      height={size}
      viewBox="7 6 114 114"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
      style={SVG_STYLE}
    >
      {artwork}
    </svg>
  );
}
