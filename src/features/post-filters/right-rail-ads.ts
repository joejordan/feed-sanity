import type { Scope } from '../../core/scope';
import type { FacebookPage } from '../../facebook/feature';
import { pageWatcher } from '../../core/page-watcher';
import { hideElement } from '../../core/surface';
import { RIGHT_RAIL } from '../../facebook/selectors';
import { rightRailSponsoredHeadings, rightRailUnits } from '../../facebook/sponsored';

/**
 * Hides Sponsored ad units in Facebook's Home right rail (including the right
 * rail mounted on alternate feeds), leaving Birthdays and other cards intact.
 * Runs until `scope` is disposed, which restores every hidden card.
 */
export function watchRightRailAds(
  page: Pick<FacebookPage, 'bridge' | 'locate' | 'watch'>,
  scope: Scope,
): void {
  const settled = new WeakSet<Element>();
  const inFlight = new WeakSet<Element>();
  const retries = new WeakMap<Element, number>();
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const inspectUnit = (unit: Element): void => {
    if (
      scope.disposed ||
      settled.has(unit) ||
      inFlight.has(unit) ||
      !unit.isConnected ||
      unit.childElementCount === 0
    ) {
      return;
    }
    inFlight.add(unit);
    void page.bridge
      .rightRailSponsored(unit)
      .then((sponsored) => {
        inFlight.delete(unit);
        if (scope.disposed || !unit.isConnected) {
          return;
        }
        if (sponsored === true) {
          settled.add(unit);
          hideElement(scope, unit);
          return;
        }
        if (sponsored === false) {
          // Only cache a negative answer once the card has rendered text;
          // empty Suspense placeholders may still resolve into an ad unit.
          if ((unit.textContent?.trim().length ?? 0) > 0) {
            settled.add(unit);
          }
          return;
        }
        // Null means React has not attached a fiber to this SSR node yet.
        const attempt = (retries.get(unit) ?? 0) + 1;
        if (attempt <= 5) {
          retries.set(unit, attempt);
          const timer = setTimeout(() => {
            timers.delete(timer);
            if (!scope.disposed) {
              inspectUnit(unit);
            }
          }, 300 * attempt);
          timers.add(timer);
        }
      })
      .catch(() => {
        inFlight.delete(unit);
      });
  };

  const inspectRail = (rail: Element): void => {
    for (const heading of rightRailSponsoredHeadings(rail, settled)) {
      settled.add(heading);
      hideElement(scope, heading);
    }
    for (const unit of rightRailUnits(rail)) {
      inspectUnit(unit);
    }
  };

  const isInsideSettled = (node: Node, rail: Element): boolean => {
    let cur: Element | null = node instanceof Element ? node : node.parentElement;
    while (cur && cur !== rail) {
      if (settled.has(cur)) {
        return true;
      }
      cur = cur.parentElement;
    }
    return false;
  };

  const rails = new Set<Element>();
  const queued = new WeakSet<Element>();
  let stopTree: (() => void) | undefined;

  const scheduleInspect = (rail: Element): void => {
    if (queued.has(rail)) {
      return;
    }
    queued.add(rail);
    queueMicrotask(() => {
      queued.delete(rail);
      if (!scope.disposed && rail.isConnected) {
        inspectRail(rail);
      }
    });
  };

  const syncTreeWatch = (): void => {
    if (rails.size > 0 && !stopTree) {
      stopTree = pageWatcher.watchTree({
        added: (node) => {
          for (const rail of rails) {
            if (rail.contains(node)) {
              if (!isInsideSettled(node, rail)) {
                scheduleInspect(rail);
              }
              break;
            }
          }
        },
      });
    } else if (rails.size === 0 && stopTree) {
      stopTree();
      stopTree = undefined;
    }
  };

  const stopWatch = page.watch(page.locate(RIGHT_RAIL), {
    added: (rail) => {
      rails.add(rail);
      syncTreeWatch();
      inspectRail(rail);
    },
    removed: (rail) => {
      rails.delete(rail);
      syncTreeWatch();
    },
  });
  scope.add(() => {
    stopWatch();
    stopTree?.();
    stopTree = undefined;
    rails.clear();
    for (const timer of timers) {
      clearTimeout(timer);
    }
    timers.clear();
  });
}
