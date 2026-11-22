import type { Feature } from '../../core/feature';
import type { Locate, LocatorSpec } from '../../core/locator';
import type { OptionSpec } from '../../core/options';
import type { PageWatcher } from '../../core/page-watcher';
import type { Scope } from '../../core/scope';
import { addStyle } from '../../core/dom';
import { defineFeature } from '../../core/feature';
import { hideElement } from '../../core/surface';

export interface ClutterRule {
  readonly key: string;
  readonly spec: LocatorSpec;
  readonly title: string;
  readonly description: string;
  readonly section?: string;
  readonly default?: boolean;
  /**
   * When provided, watches matching elements and hides the resolved container
   * via `hideElement`. When omitted, injects a zero-overhead, zero-flash CSS
   * rule from `locator.selector()` (rebuilt automatically on locator changes).
   */
  readonly target?: (element: Element) => Element;
}

export interface ClutterPage {
  readonly doc: Document;
  readonly locate: Locate;
  readonly watch: PageWatcher['watch'];
}

/**
 * Factory for reversible chrome/navigation clutter hiding features across
 * sites. Uses scoped CSS rules when no container transform is needed (zero
 * per-mutation DOM probing) and `hideElement` when wrapping containers must be
 * resolved dynamically.
 */
export function createHideClutterFeature<P extends ClutterPage>(config: {
  readonly id: string;
  readonly rules: readonly ClutterRule[];
}): Feature<P> {
  const optionsSpec: Record<string, OptionSpec> = {};
  for (const rule of config.rules) {
    optionsSpec[rule.key] = {
      section: rule.section ?? 'Navigation',
      title: rule.title,
      description: rule.description,
      default: rule.default ?? false,
    };
  }

  return defineFeature<typeof optionsSpec, P>({
    id: config.id,
    options: optionsSpec,
    setup({ page, options, scope }) {
      const activateRule = (rule: ClutterRule, ruleScope: Scope): void => {
        const locator = page.locate(rule.spec);
        if (rule.target) {
          const resolveTarget = rule.target;
          const hidden = new Map<Element, () => void>();
          ruleScope.add(
            page.watch(locator, {
              added: (el) => {
                if (!hidden.has(el)) {
                  hidden.set(el, hideElement(ruleScope, resolveTarget(el)));
                }
              },
              removed: (el) => {
                hidden.get(el)?.();
                hidden.delete(el);
              },
            }),
          );
          return;
        }
        // Static CSS-rule mode: zero per-mutation DOM probing, zero flash.
        let removeStyle: (() => void) | undefined;
        const applyCss = (): void => {
          removeStyle?.();
          removeStyle = undefined;
          const selector = locator.selector();
          if (selector) {
            removeStyle = addStyle(
              `feed_sanity_clutter_${rule.key}`,
              `${selector} { display: none !important; }`,
              page.doc,
            );
          }
        };
        applyCss();
        ruleScope.add(locator.onChange(applyCss));
        ruleScope.add(() => removeStyle?.());
      };

      for (const rule of config.rules) {
        let activeScope: Scope | undefined;
        options.watch(rule.key, (enabled) => {
          const on = enabled === true;
          if (on && !activeScope) {
            activeScope = scope.child();
            activateRule(rule, activeScope);
          } else if (!on && activeScope) {
            activeScope.dispose();
            activeScope = undefined;
          }
        });
      }
    },
  });
}
