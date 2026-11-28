// Goal-first Simple Filter Builder, shared tactile `PillSwitch` and
// `HighlightPresetButtons`, and live interactive mini-card preview
// (Feed Card for social sites, Inbox Row for Gmail).

import { useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Action, Filter } from '../../core/filter-types';
import type { FilterSchema } from './schema';
import { escapeRegex } from '../../core/filter-engine';
import { FilterIcon } from './icons';
import { withField } from './list-edit';
import { getSimpleActions, getSimpleTargets, HIGHLIGHT_PRESETS } from './schema';
import {
  detectSmartTarget,
  effectiveSimpleChips,
  extractSimpleChips,
  highlightPresetForAction,
  normalizeChipsForTarget,
  simpleActionOf,
  withSimpleChips,
} from './simple-model';
import { testFilterAgainstSample } from './tester';

export interface SwitchProps {
  readonly label: string;
  readonly checked: boolean;
  readonly hideLabel?: boolean;
  readonly onChange: (checked: boolean) => void;
}

/** Native-checkbox tactile pill switch shared across the Filter Rules UI. */
export function PillSwitch({ label, checked, hideLabel, onChange }: SwitchProps) {
  return (
    <label className="fr-switch">
      <input
        className="fr-switch-input"
        type="checkbox"
        checked={checked}
        aria-label={hideLabel ? label : undefined}
        onChange={(event) => onChange(event.target.checked)}
      />
      {hideLabel ? <span className="fs-sr-only">{label}</span> : <span>{label}</span>}
    </label>
  );
}

export interface HighlightPresetButtonsProps {
  readonly activeId?: string;
  readonly onSelect: (css: string) => void;
}

/** Shared 1-click color swatch pills for `css` highlight actions. */
export function HighlightPresetButtons({ activeId, onSelect }: HighlightPresetButtonsProps) {
  return (
    <div className="fr-swatch-row" role="group" aria-label="Highlight style">
      {HIGHLIGHT_PRESETS.map((preset) => (
        <button
          key={preset.id}
          className="fr-swatch-btn"
          type="button"
          aria-pressed={activeId === undefined ? undefined : activeId === preset.id}
          onClick={() => onSelect(preset.css)}
        >
          <span
            className="fr-swatch-dot"
            style={{ backgroundColor: preset.swatch }}
            aria-hidden="true"
          />
          {preset.label}
        </button>
      ))}
    </div>
  );
}

export interface SimpleFilterBuilderProps {
  readonly filter: Filter;
  readonly effectiveFilter: Filter;
  readonly words: readonly string[];
  readonly currentTarget: string;
  readonly schema: FilterSchema;
  readonly pendingText: string;
  readonly onPendingTextChange: (value: string) => void;
  readonly onChange: (next: Filter) => void;
  readonly onSwitchAdvanced: () => void;
}

function buildHighlightPattern(words: readonly string[]): RegExp | null {
  const active = words.filter((word) => word.trim().length > 0);
  if (active.length === 0) {
    return null;
  }
  const sorted = [...active].sort((a, b) => b.length - a.length);
  return new RegExp(`(${sorted.map(escapeRegex).join('|')})`, 'gi');
}

/** Renders `text` with any matches of `pattern` wrapped in `.fr-preview-hit` spans (zero innerHTML). */
function highlightWords(text: string, pattern: RegExp | null): ReactNode {
  if (!pattern || !text) {
    return text;
  }
  const segments = text.split(pattern);
  if (segments.length === 1) {
    return text;
  }
  const nodes: ReactNode[] = [];
  let offset = 0;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i] ?? '';
    if (i % 2 === 1) {
      nodes.push(
        <span key={`${offset}:${segment}`} className="fr-preview-hit">
          {segment}
        </span>,
      );
    } else if (segment) {
      nodes.push(segment);
    }
    offset += segment.length;
  }
  return nodes;
}

function initialsFrom(name: string): string {
  const words = name
    .replace(/<.*>/, '')
    .trim()
    .split(/[\s._@-]+/)
    .filter(Boolean);
  const first = words[0]?.[0] ?? 'A';
  const second = words[1]?.[0] ?? words[0]?.[1] ?? '';
  return `${first}${second}`.toUpperCase();
}

interface PreviewCardProps {
  readonly schema: FilterSchema;
  readonly words: readonly string[];
  readonly sampleMatched: boolean;
  readonly highlightClass?: string;
  readonly badge?: ReactNode;
  readonly idle?: boolean;
}

function SamplePreviewCard({
  schema,
  words,
  sampleMatched,
  highlightClass = '',
  badge,
  idle = false,
}: PreviewCardProps) {
  const pattern = useMemo(() => buildHighlightPattern(words), [words]);
  const sample = schema.sampleItem ?? {};
  const firstWord = words[0] ?? '';
  const secondWord = words[1] ?? '';

  if (schema.previewLayout === 'thread') {
    const sender = sample.sender?.replace(/\s*<[^>]+>/, '') || 'Daily Digest';
    const rawSubject = sample.subject || 'Weekly update';
    const rawSnippet = sample.snippet || 'Here is the latest summary for your inbox.';
    const subject =
      words.length > 0 && !sampleMatched ? `${rawSubject} — ${firstWord}` : rawSubject;
    const snippet =
      words.length > 1 && !sampleMatched ? `${rawSnippet} (${secondWord})` : rawSnippet;

    return (
      <div className={`fr-preview-row ${highlightClass} ${idle ? 'fr-preview--idle' : ''}`.trim()}>
        <span className="fr-preview-sender">{highlightWords(sender, pattern)}</span>
        <span className="fr-preview-row-text">
          <span className="fr-preview-subject">{highlightWords(subject, pattern)}</span>
          <span> — </span>
          {highlightWords(snippet, pattern)}
        </span>
        {badge}
        <span className="fr-preview-time">10:42 AM</span>
      </div>
    );
  }

  const author = sample.author || 'Alex Rivera';
  const baseBody =
    sample.body || sample.title || sample.text || `Sample ${schema.itemSingular} in your feed.`;
  let body = baseBody;
  if (words.length > 0 && !sampleMatched) {
    body = secondWord
      ? `Sharing an update about ${firstWord} and ${secondWord} today.`
      : `Sharing an update about ${firstWord} today.`;
  }

  return (
    <div className={`fr-preview-card ${highlightClass} ${idle ? 'fr-preview--idle' : ''}`.trim()}>
      <div className="fr-preview-card-head">
        <div className="fr-preview-author">
          <span className="fr-preview-avatar" aria-hidden="true">
            {initialsFrom(author)}
          </span>
          <span className="fr-preview-author-name">
            {highlightWords(author, pattern)}
            <span className="fr-preview-meta"> · 2h</span>
          </span>
        </div>
        {badge}
      </div>
      <div className="fr-preview-body">{highlightWords(body, pattern)}</div>
    </div>
  );
}

interface SimplePreviewProps {
  readonly schema: FilterSchema;
  readonly action: Action;
  readonly words: readonly string[];
  readonly sampleMatched: boolean;
  readonly peekRevealed: boolean;
  readonly onPeekChange: (revealed: boolean) => void;
}

function SimplePreview({
  schema,
  action,
  words,
  sampleMatched,
  peekRevealed,
  onPeekChange,
}: SimplePreviewProps) {
  const hasWords = words.length > 0;
  let statusText = 'Add a word above to preview';
  if (hasWords) {
    statusText = sampleMatched ? 'Matches sample' : `Previewing "${words[0]}"`;
  }

  const renderPreviewBody = (): ReactNode => {
    if (!hasWords) {
      return <SamplePreviewCard schema={schema} words={[]} sampleMatched={false} idle />;
    }
    if (action.kind === 'hide') {
      if (action.note === false) {
        return (
          <div className="fr-preview-ghost">
            Matching {schema.itemPlural} are hidden completely from your{' '}
            {schema.previewLayout === 'thread' ? 'inbox' : 'feed'}
          </div>
        );
      }
      if (!peekRevealed) {
        return (
          <div className="fr-reveal-bar">
            <div className="fr-reveal-bar-left">
              <FilterIcon name="eyeOff" size={14} />
              <span>
                Hidden {schema.itemSingular} · matched &ldquo;{words[0]}&rdquo;
              </span>
            </div>
            <button className="fr-reveal-bar-btn" type="button" onClick={() => onPeekChange(true)}>
              Show
            </button>
          </div>
        );
      }
      return (
        <SamplePreviewCard
          schema={schema}
          words={words}
          sampleMatched={sampleMatched}
          badge={
            <button className="fr-reveal-bar-btn" type="button" onClick={() => onPeekChange(false)}>
              Hide again
            </button>
          }
        />
      );
    }
    if (action.kind === 'style') {
      const activePreset = highlightPresetForAction(action);
      return (
        <SamplePreviewCard
          schema={schema}
          words={words}
          sampleMatched={sampleMatched}
          highlightClass={`fr-preview--${activePreset.id}`}
        />
      );
    }
    return (
      <SamplePreviewCard
        schema={schema}
        words={words}
        sampleMatched={sampleMatched}
        badge={
          <span className="fr-pill fr-pill--keep">
            <FilterIcon name="shield" size={12} />
            Kept visible
          </span>
        }
      />
    );
  };

  return (
    <div className="fr-preview-stage">
      <div className="fr-preview-stage-head">
        <span className="fr-preview-eyebrow">Live preview</span>
        <span className={hasWords ? 'fr-pill fr-pill--match' : 'fr-pill'} role="status">
          {statusText}
        </span>
      </div>
      {renderPreviewBody()}
    </div>
  );
}

/** Goal-first Simple Filter Builder rendered by default for new and Simple-compatible filters. */
export function SimpleFilterBuilder({
  filter,
  effectiveFilter,
  words,
  currentTarget,
  schema,
  pendingText,
  onPendingTextChange,
  onChange,
  onSwitchAdvanced,
}: SimpleFilterBuilderProps) {
  const [peekRevealed, setPeekRevealed] = useState(false);
  const [liveMessage, setLiveMessage] = useState('');
  const chipInputRef = useRef<HTMLInputElement>(null);
  const chipInputId = useId();

  const simpleActions = useMemo(() => getSimpleActions(schema), [schema]);
  const simpleTargets = useMemo(() => getSimpleTargets(schema), [schema]);

  const action: Action = filter.actions[0] ?? { kind: 'hide' };
  const targetOption = simpleTargets.find((opt) => opt.value === currentTarget) ?? simpleTargets[0];

  const chips = useMemo(() => extractSimpleChips(filter), [filter]);
  const keyedChips = useMemo(() => {
    const counts = new Map<string, number>();
    return chips.map((word, index) => {
      const norm = word.toLowerCase();
      const seen = counts.get(norm) ?? 0;
      counts.set(norm, seen + 1);
      return { word, index, key: `${norm}#${seen}` };
    });
  }, [chips]);

  const sampleMatched = useMemo(
    () =>
      Boolean(
        schema.sampleItem &&
          words.length > 0 &&
          testFilterAgainstSample(effectiveFilter, schema.sampleItem, schema).matched,
      ),
    [effectiveFilter, schema, words.length],
  );

  const smartNudge = useMemo(
    () => detectSmartTarget(pendingText, currentTarget, schema),
    [currentTarget, pendingText, schema],
  );

  const selectGoal = (nextActionKind: string) => {
    if (nextActionKind === action.kind) {
      return;
    }
    setPeekRevealed(false);
    onChange({
      ...filter,
      stopAfter: nextActionKind === 'keep',
      actions: [simpleActionOf(nextActionKind, action)],
    });
  };

  const updateAction = (next: Action) => {
    setPeekRevealed(false);
    onChange({ ...filter, actions: [next] });
  };

  const selectTarget = (nextTarget: string) => {
    const normalized = normalizeChipsForTarget(
      effectiveSimpleChips(filter, pendingText),
      nextTarget,
      schema,
    );
    onChange(withSimpleChips(filter, nextTarget, normalized));
    if (pendingText) {
      onPendingTextChange('');
    }
  };

  const flushPending = (raw: string) => {
    const merged = normalizeChipsForTarget(
      effectiveSimpleChips(filter, raw),
      currentTarget,
      schema,
    );
    const added = merged.slice(chips.length);
    if (added.length > 0 || merged.length !== chips.length) {
      onChange(withSimpleChips(filter, currentTarget, merged));
      if (added.length > 0) {
        setLiveMessage(`Added ${added.join(', ')}`);
      }
    }
    onPendingTextChange('');
  };

  const removeChip = (index: number) => {
    const removed = chips[index];
    const nextChips = chips.filter((_word, at) => at !== index);
    onChange(withSimpleChips(filter, currentTarget, nextChips));
    if (removed) {
      setLiveMessage(`Removed ${removed}`);
    }
    chipInputRef.current?.focus();
  };

  const activePreset = highlightPresetForAction(action);

  return (
    <div className="fr-simple">
      <div className="fr-section">
        <div className="fr-section-head">
          <span className="fr-section-label">What should happen</span>
        </div>
        <div className="fr-tiles-grid" role="group" aria-label="What should happen">
          {simpleActions.map((opt) => (
            <button
              key={opt.value}
              className="fr-goal-tile"
              type="button"
              data-tone={opt.tone}
              aria-pressed={action.kind === opt.value}
              onClick={() => selectGoal(opt.value)}
            >
              <span className="fr-goal-tile-top">
                <span className="fr-goal-icon">
                  <FilterIcon name={opt.simple.icon} size={15} />
                </span>
                <span>{opt.simple.title}</span>
              </span>
              <span className="fr-goal-tile-desc">{opt.simple.description}</span>
            </button>
          ))}
        </div>

        <div className="fr-context-strip">
          {action.kind === 'hide' && (
            <PillSwitch
              label="Show a note in its place, so nothing vanishes silently"
              checked={action.note !== false}
              onChange={(on) =>
                updateAction(on ? withField(action, 'note', undefined) : { ...action, note: false })
              }
            />
          )}

          {action.kind === 'style' && (
            <>
              <span className="fr-section-label">Highlight style</span>
              <HighlightPresetButtons
                activeId={activePreset.id}
                onSelect={(css) => updateAction({ ...action, css })}
              />
            </>
          )}

          {action.kind === 'keep' && (
            <span className="fr-context-note">
              <FilterIcon name="shield" size={14} />
              Stops the filters below it, so matching {schema.itemPlural} always stay visible.
            </span>
          )}
        </div>
      </div>

      <div className="fr-section">
        <div className="fr-section-head">
          <label className="fr-section-label" htmlFor={chipInputId}>
            Match {schema.itemPlural} containing
          </label>
          <span className="fr-section-hint">Press Enter or comma to add multiple</span>
        </div>

        <div className="fr-target-pills" role="group" aria-label={schema.targetLabel}>
          {simpleTargets.map((opt) => (
            <button
              key={opt.value}
              className="fr-target-pill"
              type="button"
              aria-pressed={currentTarget === opt.value}
              onClick={() => selectTarget(opt.value)}
            >
              {opt.simpleLabel ?? opt.label}
            </button>
          ))}
          {schema.targets.length > simpleTargets.length && (
            <button
              className="fr-target-pill fr-target-pill--more"
              type="button"
              title="Open Advanced mode for every part, the schedule and CSS selectors"
              onClick={onSwitchAdvanced}
            >
              More…
            </button>
          )}
        </div>

        <div
          className="fr-chip-box"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              chipInputRef.current?.focus();
            }
          }}
        >
          {keyedChips.map(({ word, index, key }) => (
            <span key={key} className="fr-word-chip">
              <span>{word}</span>
              <button
                className="fr-word-chip-remove"
                type="button"
                aria-label={`Remove ${word}`}
                onClick={() => removeChip(index)}
              >
                ×
              </button>
            </span>
          ))}
          <input
            ref={chipInputRef}
            id={chipInputId}
            className="fr-chip-text-input"
            type="text"
            aria-label="Text to look for"
            placeholder={
              chips.length > 0
                ? 'Add another word...'
                : (targetOption?.placeholder ?? 'Add a word or phrase...')
            }
            value={pendingText}
            onChange={(event) => {
              const raw = event.target.value;
              if (raw.includes(',')) {
                flushPending(raw);
              } else {
                onPendingTextChange(raw);
              }
            }}
            onBlur={() => {
              if (pendingText.trim()) {
                flushPending(pendingText);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                if (pendingText.trim()) {
                  flushPending(pendingText);
                }
              } else if (event.key === 'Backspace' && !pendingText && chips.length > 0) {
                removeChip(chips.length - 1);
              }
            }}
          />
        </div>
        <span className="fs-sr-only" aria-live="polite">
          {liveMessage}
        </span>

        {smartNudge && (
          <div className="fr-smart-nudge">
            <span>Looks like a {smartNudge.label.toLowerCase()}.</span>
            <button
              className="fr-smart-nudge-btn"
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectTarget(smartNudge.targetId)}
            >
              Match as {smartNudge.label}
            </button>
          </div>
        )}
      </div>

      <SimplePreview
        schema={schema}
        action={action}
        words={words}
        sampleMatched={sampleMatched}
        peekRevealed={peekRevealed}
        onPeekChange={setPeekRevealed}
      />
    </div>
  );
}
