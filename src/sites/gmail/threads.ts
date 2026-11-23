// Gmail `ThreadListCapability` built purely on semantic ARIA/DOM observation
// (zero React, zero MAIN-world bridge, strictly Trusted Types safe).

import type { FeedStats, ThreadListCapability, ThreadRow } from '../../capabilities';
import type { DomEnvironment } from '../../core/dom-env';
import type { FilterFields } from '../../core/filter-engine';
import type { Locate } from '../../core/locator';
import { callSafely, Listeners } from '../../core/listeners';
import { createLogger } from '../../core/log';
import { OWN_ATTR } from '../../core/surface';
import { GMAIL_THREAD_ROW } from './selectors';

const log = createLogger('gmail-threads');

export interface GmailThreadRow extends ThreadRow {
  readonly isAd: boolean;
  readonly readLowerText: () => string;
}

// Strict exact-match ad badges (never unconstrained substring `*=` that could match
// filenames like `Sponsored_Deck.pdf` or user-created labels).
const AD_ATTR_SELECTOR =
  '[data-ad="true"], [data-tooltip="Ad"], [data-tooltip="Sponsored"], [aria-label="Ad"], [aria-label="Sponsored"]';

const NON_AD_TEXT_ANCESTOR =
  '[data-thread-subject], [data-snippet], [role="link"], span[email], .bog, .av';

function extractThreadId(row: Element): string | null {
  const direct =
    row.getAttribute('data-legacy-thread-id') ??
    row.getAttribute('data-thread-id') ??
    row.querySelector('[data-legacy-thread-id]')?.getAttribute('data-legacy-thread-id') ??
    row.querySelector('[data-thread-id]')?.getAttribute('data-thread-id');
  if (direct && direct.length > 0) {
    return direct;
  }
  return row.id && row.id.length > 0 ? row.id : null;
}

function isUnreadRow(row: Element): boolean {
  if (row.getAttribute('data-unread') === 'true' || row.classList.contains('zE')) {
    return true;
  }
  const label = row.getAttribute('aria-label');
  return typeof label === 'string' && /\bunread\b/i.test(label);
}

function isAdRow(row: Element): boolean {
  if (row.getAttribute('data-ad') === 'true' || row.querySelector(AD_ATTR_SELECTOR) !== null) {
    return true;
  }
  // Real user messages carry a sender `span[email]` or Gmail legacy thread ID;
  // avoid text-heuristic false positives on ordinary emails without an explicit ad marker.
  if (
    row.hasAttribute('data-legacy-thread-id') ||
    row.querySelector('[data-legacy-thread-id], span[email]') !== null
  ) {
    return false;
  }
  const doc = row.ownerDocument ?? document;
  const walker = doc.createTreeWalker(row, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = node.nodeValue;
    if (!value || value.length > 16) {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed !== 'Ad' && trimmed !== 'Sponsored') {
      continue;
    }
    const parent = node.parentElement;
    if (!parent || parent.closest(NON_AD_TEXT_ANCESTOR)) {
      continue;
    }
    if (parent.childNodes.length === 1) {
      return true;
    }
  }
  return false;
}

export class GmailThreadList implements ThreadListCapability {
  readonly #env: DomEnvironment;
  readonly #locate: Locate;
  readonly #tracked = new Map<HTMLElement, GmailThreadRow>();
  readonly #addListeners = new Listeners<[GmailThreadRow]>(log);
  readonly #removeListeners = new Listeners<[GmailThreadRow]>(log);
  readonly #resetListeners = new Listeners<[]>(log);

  #stop: (() => void) | undefined;
  #stopUrl: (() => void) | undefined;
  #started = false;

  constructor(env: DomEnvironment, locate: Locate) {
    this.#env = env;
    this.#locate = locate;
  }

  onAdd(listener: (row: GmailThreadRow) => void): () => void {
    for (const row of this.#tracked.values()) {
      callSafely(log, listener, row);
    }
    const remove = this.#addListeners.add(listener);
    this.#ensureStarted();
    return () => {
      remove();
      this.#maybeStop();
    };
  }

  onRemove(listener: (row: GmailThreadRow) => void): () => void {
    const remove = this.#removeListeners.add(listener);
    return () => {
      remove();
      this.#maybeStop();
    };
  }

  onReset(listener: () => void): () => void {
    const remove = this.#resetListeners.add(listener);
    return () => {
      remove();
      this.#maybeStop();
    };
  }

  stats(): FeedStats {
    let withId = 0;
    for (const row of this.#tracked.values()) {
      if (row.id !== null) {
        withId++;
      }
    }
    return {
      started: this.#started,
      tracked: this.#tracked.size,
      withId,
      withoutId: this.#tracked.size - withId,
      identifying: 0,
      unrecognised: 0,
    };
  }

  #ensureStarted(): void {
    if (this.#stop) {
      return;
    }
    this.#started = true;
    this.#stop = this.#env.watch(this.#locate(GMAIL_THREAD_ROW), {
      added: (el) => {
        if (el instanceof HTMLElement) {
          this.#enter(el);
        }
      },
      removed: (el) => {
        if (el instanceof HTMLElement) {
          this.#leave(el);
        }
      },
    });
    this.#stopUrl = this.#env.onUrlChange(() => {
      this.#resetListeners.emit();
    });
  }

  #maybeStop(): void {
    const active = this.#addListeners.size + this.#removeListeners.size + this.#resetListeners.size;
    if (active > 0) {
      return;
    }
    this.#started = false;
    this.#stop?.();
    this.#stop = undefined;
    this.#stopUrl?.();
    this.#stopUrl = undefined;
    this.#tracked.clear();
  }

  #enter(element: HTMLElement): void {
    if (this.#tracked.has(element) || element.hasAttribute(OWN_ATTR)) {
      return;
    }
    let cachedLower: string | undefined;
    const readLowerText = (): string => {
      cachedLower ??= (element.textContent ?? '').toLowerCase();
      return cachedLower;
    };
    const isAd = isAdRow(element);
    const readFields = (): FilterFields => {
      let fullText: string | undefined;
      let sender: string | undefined;
      let subject: string | undefined;
      let snippet: string | undefined;
      let labels: string[] | undefined;

      return {
        get(name) {
          switch (name) {
            case 'all_content':
            case 'any':
              fullText ??= element.textContent ?? '';
              return fullText;
            case 'sender':
              if (sender === undefined) {
                const senderEl = element.querySelector('span[email], .yW');
                const emailAttr = senderEl?.getAttribute('email') ?? '';
                const senderName = senderEl?.textContent?.trim() ?? '';
                sender =
                  emailAttr && !senderName.includes(emailAttr)
                    ? `${senderName} <${emailAttr}>`.trim()
                    : senderName || emailAttr;
              }
              return sender;
            case 'subject':
              subject ??=
                element.querySelector('[data-thread-subject], .bog')?.textContent?.trim() ?? '';
              return subject;
            case 'snippet':
              snippet ??= element.querySelector('[data-snippet], .y2')?.textContent?.trim() ?? '';
              return snippet;
            case 'label':
              labels ??= [...element.querySelectorAll('.av, [data-label-name]')]
                .map((el) => el.textContent?.trim() ?? '')
                .filter((val) => val.length > 0);
              return labels;
            case 'sponsored':
              return isAd ? 'sponsored' : '';
            default:
              return null;
          }
        },
      };
    };
    const row: GmailThreadRow = {
      element,
      id: extractThreadId(element),
      unread: isUnreadRow(element),
      isAd,
      readLowerText,
      readFields,
    };
    this.#tracked.set(element, row);
    this.#addListeners.emit(row);
  }

  #leave(element: HTMLElement): void {
    const row = this.#tracked.get(element);
    if (!row) {
      return;
    }
    this.#tracked.delete(element);
    this.#removeListeners.emit(row);
  }
}
