import { useSyncExternalStore } from 'react';
import type { DomEnvironment } from '../../core/dom-env';
import type { Feature } from '../../core/feature';
import type { Locate, LocatorSpec } from '../../core/locator';
import type { PageWatcher } from '../../core/page-watcher';
import type { Scope } from '../../core/scope';
import type { SlotPlacement } from '../../core/surface';
import type { ThemeDocumentV1 } from '../../core/theming';
import type { Watched } from '../../ui/watched';
import { NAME } from '../../../project';
import { defineFeature } from '../../core/feature';
import { pageWatcher } from '../../core/page-watcher';
import { OWN_ATTR, whileOnRoute } from '../../core/surface';
import { describeThemeDocument, readThemeDocument, THEME_DATA_KEY } from '../../core/theming';
import { HOST_TAG, renderInShadow } from '../../ui/mount';
import { BrandMark, BrandWordmark, UiIcon } from '../../ui/primitives';
import css from './display-notice.css?inline';

export const DISPLAY_NOTICE_HOST_ID = 'feed_sanity_display_notice';

export type DisplayNoticeLayout = 'inset' | 'centered';

export interface DisplayNoticePage {
  readonly doc?: Document;
  readonly env?: Pick<DomEnvironment, 'watcher' | 'whileOnRoute'>;
  readonly locate: Locate;
  readonly watch: PageWatcher['watch'];
  readonly openOptions?: (initialSection?: string) => void;
}

export interface DisplayNoticeAnchor {
  readonly anchor: Element;
  readonly placement: SlotPlacement;
}

export interface DisplayNoticeSpec {
  readonly id: string;
  readonly siteName: string;
  readonly hostId?: string;
  readonly layout?: DisplayNoticeLayout;
  readonly matchesRoute: (loc: Pick<Location, 'pathname' | 'search'>) => boolean;
  readonly container: LocatorSpec;
  readonly findAnchor?: (container: Element) => DisplayNoticeAnchor;
}

export type { ThemeSummary as DisplayNoticeSummary } from '../../core/theming';
export { describeThemeDocument as describeActiveTheme } from '../../core/theming';

function nonOwnChildren(parent: Element): Element[] {
  const result: Element[] = [];
  for (const child of parent.children) {
    if (!child.hasAttribute(OWN_ATTR)) {
      result.push(child);
    }
  }
  return result;
}

function isHorizontalControl(el: Element): boolean {
  const tag = el.localName;
  if (tag === 'button' || tag === 'a') {
    return true;
  }
  const role = el.getAttribute('role');
  return role === 'button' || role === 'link';
}

/**
 * Finds a layout-safe insertion anchor directly after the row containing
 * `headerSelector` (unwrapping single-child vertical layout wrappers while
 * never descending into a horizontal header bar), falling back to prepending
 * inside `container` when no header is present yet.
 */
export function findHeaderAfterAnchor(
  container: Element,
  headerSelector: string,
): DisplayNoticeAnchor {
  const header = container.querySelector(headerSelector);
  if (!header) {
    return { anchor: container, placement: 'prepend' };
  }
  let stack: Element = container;
  let stackChildren = nonOwnChildren(stack);
  while (stackChildren.length === 1) {
    const only = stackChildren[0];
    if (!only || only === header) {
      break;
    }
    const innerChildren = nonOwnChildren(only);
    // Stop before descending into a header bar (single heading child or heading beside
    // inline Back/Close controls) so the notice always mounts AFTER the header bar row.
    if (
      innerChildren.length === 0 ||
      (innerChildren.length === 1 && innerChildren[0] === header) ||
      innerChildren.some(isHorizontalControl)
    ) {
      break;
    }
    stack = only;
    stackChildren = innerChildren;
  }
  let headerRow: Element = header;
  while (headerRow.parentElement && headerRow.parentElement !== stack) {
    headerRow = headerRow.parentElement;
  }
  if (headerRow.parentElement === stack) {
    return { anchor: headerRow, placement: 'after' };
  }
  return { anchor: stack, placement: 'prepend' };
}

function isPlacedAt(anchor: Element, placement: SlotPlacement, element: Element): boolean {
  const parent = anchor.parentElement;
  switch (placement) {
    case 'before':
      return (
        parent !== null && element.parentElement === parent && element.nextElementSibling === anchor
      );
    case 'after':
      return (
        parent !== null && element.parentElement === parent && anchor.nextElementSibling === element
      );
    case 'prepend':
      return element.parentElement === anchor && anchor.firstElementChild === element;
    case 'append':
      return element.parentElement === anchor && anchor.lastElementChild === element;
  }
}

function insertRelative(anchor: Element, placement: SlotPlacement, element: Element): void {
  if (!anchor.isConnected || anchor === element || isPlacedAt(anchor, placement, element)) {
    return;
  }
  switch (placement) {
    case 'before':
      anchor.before(element);
      break;
    case 'after':
      anchor.after(element);
      break;
    case 'prepend':
      anchor.prepend(element);
      break;
    case 'append':
      anchor.append(element);
      break;
  }
}

function DisplayNotice({
  siteName,
  layout,
  state,
  onOpenAppearance,
}: {
  readonly siteName: string;
  readonly layout: DisplayNoticeLayout;
  readonly state: Watched<ThemeDocumentV1>;
  readonly onOpenAppearance: () => void;
}) {
  const doc = useSyncExternalStore(state.subscribe, state.get);
  const { overriding, label } = describeThemeDocument(doc);

  return (
    <aside
      className="fs-display-notice"
      data-layout={layout}
      aria-label="Feed Sanity display settings notice"
    >
      <div className="fs-display-notice-main">
        <BrandMark size={32} />
        <div className="fs-display-notice-copy">
          <div className="fs-display-notice-head">
            <h3 className="fs-display-notice-title">
              <span className="fs-sr-only">{NAME}</span>
              <BrandWordmark height={15} />
              <span> is active</span>
            </h3>
            <span className="fs-display-notice-badge" data-active={overriding ? 'true' : undefined}>
              {label}
            </span>
          </div>
          <p className="fs-display-notice-desc">
            {overriding
              ? `Your Feed Sanity theme overrides ${siteName}'s display colors and typography. Switch to Site Default in Appearance to use ${siteName}'s settings below.`
              : `${siteName}'s native display settings are active. Open Appearance to pick presets, fonts, or Studio themes.`}
          </p>
        </div>
      </div>
      <button type="button" className="fs-display-notice-btn" onClick={onOpenAppearance}>
        <span>Open Appearance</span>
        <UiIcon name="chevronRight" size={14} />
      </button>
    </aside>
  );
}

/**
 * Creates a site-agnostic feature that mounts a compact Shadow DOM notice on a
 * host site's native Display / Dark Mode settings page, telling the user Feed
 * Sanity is active and providing a direct button to open the Appearance panel.
 */
export function createDisplayNoticeFeature<P extends DisplayNoticePage>({
  id,
  siteName,
  hostId = DISPLAY_NOTICE_HOST_ID,
  layout = 'inset',
  matchesRoute,
  container: containerSpec,
  findAnchor = (container) => ({ anchor: container, placement: 'prepend' }),
}: DisplayNoticeSpec): Feature<P> {
  return defineFeature<Record<never, never>, P>({
    id,
    options: {},
    setup({ page, data, scope }) {
      const savedTheme = data.value(THEME_DATA_KEY, readThemeDocument);
      const state: Watched<ThemeDocumentV1> = {
        get: () => savedTheme.get(),
        subscribe: (onChange) => savedTheme.onChange(() => onChange()),
      };

      const doc = page.doc ?? document;
      const watcher = page.env?.watcher ?? pageWatcher;

      const onEnterRoute = (routeScope: Scope): void => {
        const containerLocator = page.locate(containerSpec);
        const containers = new Set<Element>();
        let mountedScope: Scope | undefined;
        let mountedContainer: Element | undefined;

        const unmount = (): void => {
          mountedScope?.dispose();
          mountedScope = undefined;
          mountedContainer = undefined;
        };

        const mountIn = (container: Element): void => {
          if (mountedScope || !container.isConnected) {
            return;
          }
          const itemScope = routeScope.child();
          const host = doc.createElement(HOST_TAG);
          host.id = hostId;
          host.setAttribute(OWN_ATTR, '');
          let reanchorQueued = false;

          const attach = (): void => {
            const { anchor, placement } = findAnchor(container);
            insertRelative(anchor, placement, host);
          };

          const scheduleReanchor = (): void => {
            if (reanchorQueued || itemScope.disposed) {
              return;
            }
            reanchorQueued = true;
            queueMicrotask(() => {
              reanchorQueued = false;
              if (!itemScope.disposed && container.isConnected) {
                attach();
              }
            });
          };

          attach();
          itemScope.add(() => host.remove());
          itemScope.add(
            renderInShadow(
              host,
              <DisplayNotice
                siteName={siteName}
                layout={layout}
                state={state}
                onOpenAppearance={() => page.openOptions?.('Appearance')}
              />,
              css,
            ),
          );
          // Re-anchor the existing Shadow DOM host when the host SPA detaches it,
          // replaces an inner wrapper, or asynchronously renders a preferred inner
          // anchor (e.g. Facebook `[role="radiogroup"]` or X `#detail-header`).
          itemScope.add(
            watcher.watchTree({
              added: (el) => {
                if (container.contains(el)) {
                  scheduleReanchor();
                }
              },
              removed: () => {
                if (!host.isConnected) {
                  scheduleReanchor();
                }
              },
            }),
          );
          mountedScope = itemScope;
          mountedContainer = container;
        };

        const syncContainer = (): void => {
          let preferred = containerLocator.first(doc);
          if (!preferred?.isConnected) {
            preferred = null;
            for (const candidate of containers) {
              if (candidate.isConnected) {
                preferred = candidate;
                break;
              }
            }
          }
          if (preferred === mountedContainer) {
            return;
          }
          unmount();
          if (preferred) {
            mountIn(preferred);
          }
        };

        const stopWatch = page.watch(containerLocator, {
          added: (container) => {
            containers.add(container);
            syncContainer();
          },
          removed: (container) => {
            containers.delete(container);
            syncContainer();
          },
        });

        routeScope.add(() => {
          stopWatch();
          containers.clear();
          unmount();
        });
      };

      if (page.env) {
        page.env.whileOnRoute(scope, matchesRoute, onEnterRoute);
      } else {
        whileOnRoute(scope, matchesRoute, onEnterRoute, { watcher });
      }
    },
  });
}
