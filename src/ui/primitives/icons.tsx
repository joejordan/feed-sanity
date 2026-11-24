// Minimal monochrome Lucide-style JSX icons (100% Trusted Types safe, zero external icon fonts).

export type UiIconName =
  | 'shield'
  | 'sliders'
  | 'play'
  | 'pause'
  | 'palette'
  | 'globe'
  | 'database'
  | 'activity'
  | 'search'
  | 'chevronRight'
  | 'x'
  | 'sparkles'
  | 'externalLink'
  | 'grip'
  | 'refresh';

export interface UiIconProps {
  readonly name: UiIconName;
  readonly size?: number;
  readonly className?: string;
}

export function UiIcon({ name, size = 15, className }: UiIconProps) {
  return (
    <svg
      className={className ? `fs-icon ${className}` : 'fs-icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === 'shield' && <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />}
      {name === 'sliders' && (
        <>
          <line x1="4" y1="21" x2="4" y2="14" />
          <line x1="4" y1="10" x2="4" y2="3" />
          <line x1="12" y1="21" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12" y2="3" />
          <line x1="20" y1="21" x2="20" y2="16" />
          <line x1="20" y1="12" x2="20" y2="3" />
          <line x1="1" y1="14" x2="7" y2="14" />
          <line x1="9" y1="8" x2="15" y2="8" />
          <line x1="17" y1="16" x2="23" y2="16" />
        </>
      )}
      {name === 'play' && <polygon points="6 4 20 12 6 20 6 4" />}
      {name === 'pause' && (
        <>
          <rect x="6" y="4" width="4" height="16" rx="1" />
          <rect x="14" y="4" width="4" height="16" rx="1" />
        </>
      )}
      {name === 'palette' && (
        <>
          <circle cx="13.5" cy="6.5" r="1" />
          <circle cx="17.5" cy="10.5" r="1" />
          <circle cx="8.5" cy="7.5" r="1" />
          <circle cx="6.5" cy="12.5" r="1" />
          <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.6-.7 1.6-1.6 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.7-1.6 1.6-1.6H16c3.3 0 6-2.7 6-6 0-5-4.5-8.6-10-8.6z" />
        </>
      )}
      {name === 'globe' && (
        <>
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </>
      )}
      {name === 'database' && (
        <>
          <ellipse cx="12" cy="5" rx="9" ry="3" />
          <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
          <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
        </>
      )}
      {name === 'activity' && <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />}
      {name === 'search' && (
        <>
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </>
      )}
      {name === 'chevronRight' && <polyline points="9 18 15 12 9 6" />}
      {name === 'x' && (
        <>
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </>
      )}
      {name === 'sparkles' && (
        <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
      )}
      {name === 'externalLink' && (
        <>
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </>
      )}
      {name === 'grip' && (
        <>
          <circle cx="9" cy="6" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="15" cy="6" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="9" cy="12" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="15" cy="12" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="9" cy="18" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="15" cy="18" r="1.2" fill="currentColor" stroke="none" />
        </>
      )}
      {name === 'refresh' && (
        <>
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <polyline points="21 3 21 9 15 9" />
        </>
      )}
    </svg>
  );
}
