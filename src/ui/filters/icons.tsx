// Lightweight inline SVG icons (zero external icon library dependencies).

export type FilterIconName =
  | 'alert'
  | 'back'
  | 'check'
  | 'close'
  | 'copy'
  | 'down'
  | 'edit'
  | 'play'
  | 'plus'
  | 'sparkle'
  | 'trash'
  | 'up';

const PATHS: Readonly<Record<FilterIconName, string>> = {
  alert: 'M8 2.2 14.2 13H1.8L8 2.2Zm0 4.3v3m0 2h.01',
  back: 'M10 3.5 5.5 8 10 12.5',
  check: 'M3.5 8.5 6.5 11.5 12.5 4.5',
  close: 'M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5',
  copy: 'M5.5 5.5h7v7h-7v-7Zm-2 5V3.5h7',
  down: 'M4 6l4 4 4-4',
  edit: 'M11.3 2.7a1.5 1.5 0 0 1 2.1 2.1l-7 7-2.9.8.8-2.9 7-7Z',
  play: 'M5 3.5 12.5 8 5 12.5V3.5Z',
  plus: 'M8 3.5v9M3.5 8h9',
  sparkle: 'M8 2l1.4 3.6L13 7l-3.6 1.4L8 12l-1.4-3.6L3 7l3.6-1.4L8 2Z',
  trash: 'M3.5 4.5h9M6 4.5V3h4v1.5M5 4.5l.5 8.5h5l.5-8.5',
  up: 'M4 10l4-4 4 4',
};

export function FilterIcon({ name, size = 15 }: { name: FilterIconName; size?: number }) {
  return (
    <svg
      className="fr-svg"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
