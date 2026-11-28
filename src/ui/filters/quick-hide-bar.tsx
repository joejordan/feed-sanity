import { useState } from 'react';
import type { Filter } from '../../core/filter-types';
import type { FilterSchema } from './schema';
import { createQuickHideFilter } from './simple-model';

export interface QuickHideBarProps {
  readonly schema: FilterSchema;
  readonly onQuickHide: (created: Filter) => void;
}

/** 1-line Quick Hide input isolated in its own component so typing never re-renders the filter list. */
export function QuickHideBar({ schema, onQuickHide }: QuickHideBarProps) {
  const [text, setText] = useState('');

  const submit = () => {
    const created = createQuickHideFilter(text, schema);
    if (!created) {
      return;
    }
    onQuickHide(created);
    setText('');
  };

  return (
    <div className="fr-quick-bar">
      <span className="fr-quick-label">Quick hide</span>
      <input
        className="field fr-quick-input"
        type="text"
        aria-label={`Quick hide on ${schema.siteName}`}
        placeholder={`Words to hide ${schema.itemPlural} by, separated by commas...`}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            submit();
          }
        }}
      />
      <button
        className="button fr-quick-btn"
        type="button"
        disabled={!text.trim()}
        onClick={submit}
      >
        Quick hide
      </button>
    </div>
  );
}
