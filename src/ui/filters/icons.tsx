// Lightweight inline SVG icons (zero external icon library dependencies).

export type FilterIconName =
  | 'alert'
  | 'back'
  | 'check'
  | 'close'
  | 'copy'
  | 'down'
  | 'edit'
  | 'eyeOff'
  | 'folder'
  | 'play'
  | 'plus'
  | 'shield'
  | 'sliders'
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
  eyeOff:
    'M11.8 11.8A7.2 7.2 0 0 1 8 13c-4.2 0-6.5-5-6.5-5a12.5 12.5 0 0 1 3-3.6M6.6 3.2A6.5 6.5 0 0 1 8 3c4.2 0 6.5 5 6.5 5a12.5 12.5 0 0 1-1.4 2M2 2l12 12',
  folder:
    'M14 12.2a1.3 1.3 0 0 1-1.3 1.3H3.3A1.3 1.3 0 0 1 2 12.2V4.3A1.3 1.3 0 0 1 3.3 3h3l1.4 1.8h5A1.3 1.3 0 0 1 14 6.1v6.1Z',
  play: 'M5 3.5 12.5 8 5 12.5V3.5Z',
  plus: 'M8 3.5v9M3.5 8h9',
  shield: 'M8 14.2s5-2.5 5-6.4V3.5L8 1.8 3 3.5v4.3c0 3.9 5 6.4 5 6.4Z',
  sliders:
    'M3 13.5V9M3 6.5v-4M8 13.5v-6M8 5v-2.5M13 13.5V10M13 7.5v-5M1.3 9h3.4M6.3 5h3.4M11.3 10h3.4',
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
