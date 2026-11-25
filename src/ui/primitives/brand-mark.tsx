import { useId, useMemo } from 'react';

export interface BrandMarkProps {
  /** Pixel width and height of the square Moonglade mark (small cut, designed for 14–48px). */
  readonly size?: number;
  readonly className?: string;
  /** Accessible label; when omitted, the mark is decorative (`aria-hidden="true"`). */
  readonly label?: string;
}

const TILE_PATH =
  'M36 0h56c26 0 36 10 36 36v56c0 26-10 36-36 36H36C10 128 0 118 0 92V36C0 10 10 0 36 0Z';
const SVG_STYLE = { display: 'block', flex: 'none' } as const;

/**
 * Feed Sanity Moonglade small-cut mark (Night Edition).
 * Pure JSX SVG (100% Trusted Types safe) with `useId()`-scoped `<defs>` IDs so
 * multiple marks rendered in the same document or ShadowRoot never collide.
 */
export function BrandMark({ size = 28, className, label }: BrandMarkProps) {
  const uid = useId();
  const artwork = useMemo(() => {
    const skyId = `${uid}-sky`;
    const moonId = `${uid}-moon`;
    const wakeId = `${uid}-wake`;
    const haloId = `${uid}-halo`;
    const rimId = `${uid}-rim`;
    const clipId = `${uid}-clip`;

    return (
      <>
        <defs>
          <linearGradient id={skyId} x1="64" y1="0" x2="64" y2="128" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#080D26" />
            <stop offset="0.5" stopColor="#11224D" />
            <stop offset="1" stopColor="#1C427C" />
          </linearGradient>
          <linearGradient
            id={moonId}
            x1="50"
            y1="8.333"
            x2="78"
            y2="45.667"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="#FFFCEE" />
            <stop offset="1" stopColor="#FFDC98" />
          </linearGradient>
          <linearGradient
            id={wakeId}
            x1="64"
            y1="56"
            x2="64"
            y2="120"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="#B9FFF1" />
            <stop offset="0.5" stopColor="#5BE9E0" />
            <stop offset="1" stopColor="#22AEEA" />
          </linearGradient>
          <radialGradient id={haloId} cx="64" cy="27" r="56" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#FFE7AE" stopOpacity="0.5" />
            <stop offset="0.4" stopColor="#6FD8F0" stopOpacity="0.14" />
            <stop offset="1" stopColor="#6FD8F0" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={rimId} x1="64" y1="0" x2="64" y2="128" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.6" />
            <stop offset="0.5" stopColor="#CDEBFF" stopOpacity="0.24" />
            <stop offset="1" stopColor="#7FE3EC" stopOpacity="0.42" />
          </linearGradient>
          <clipPath id={clipId}>
            <path d={TILE_PATH} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <path d="M0 0h128v128H0z" fill={`url(#${skyId})`} />
          <path d="M0 0h128v128H0z" fill={`url(#${haloId})`} />
          <circle cx="64" cy="27" r="21" fill={`url(#${moonId})`} />
          <g fill={`url(#${wakeId})`}>
            <rect x="16" y="56" width="96" height="16" rx="8" />
            <rect x="32" y="80" width="64" height="16" rx="8" />
            <rect x="48" y="104" width="32" height="16" rx="8" />
          </g>
          <path d={TILE_PATH} fill="none" stroke={`url(#${rimId})`} strokeWidth="8" />
        </g>
      </>
    );
  }, [uid]);

  return (
    <svg
      className={className ? `fs-brand-mark ${className}` : 'fs-brand-mark'}
      width={size}
      height={size}
      viewBox="0 0 128 128"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
      style={SVG_STYLE}
    >
      {artwork}
    </svg>
  );
}
