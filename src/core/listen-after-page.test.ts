import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listenAfterPage } from './listen-after-page';
import { createLogger } from './log';
import { Scope } from './scope';

describe('listenAfterPage', () => {
  let scope: Scope;
  /** What heard each event, in order. */
  let heard: string[];
  const onPage = (): void => {
    heard.push('page');
  };

  const over = (): MouseEvent => {
    const event = new MouseEvent('mouseover', { bubbles: true });
    document.body.dispatchEvent(event);
    return event;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    scope = new Scope();
    heard = [];
    document.addEventListener('mouseover', onPage);
  });

  afterEach(() => {
    scope.dispose();
    document.removeEventListener('mouseover', onPage);
    vi.useRealTimers();
  });

  it("hears an event after the page's listeners, and lets it go on", () => {
    listenAfterPage(scope, ['mouseover'], (event) => {
      heard.push(event.type);
    });
    const later = (): void => {
      heard.push('later');
    };
    addEventListener('mouseover', later);

    over();
    vi.runAllTimers();

    expect(heard).toEqual(['page', 'mouseover', 'later']);
    removeEventListener('mouseover', later);
  });

  it('hears an event the page stopped on the next task, once', () => {
    const handler = vi.fn();
    listenAfterPage(scope, ['mouseover'], handler);
    const stop = (event: Event): void => event.stopPropagation();
    document.addEventListener('mouseover', stop);

    const event = over();
    expect(handler).not.toHaveBeenCalled();
    vi.runAllTimers();

    expect(handler).toHaveBeenCalledExactlyOnceWith(event);
    document.removeEventListener('mouseover', stop);
  });

  it('hears an event that does not bubble on the next task', () => {
    const handler = vi.fn();
    listenAfterPage(scope, ['focus'], handler);

    document.body.dispatchEvent(new FocusEvent('focus'));
    vi.runAllTimers();

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('stops listening when the scope is disposed or when asked to, and drops what waits', () => {
    const handler = vi.fn();
    const stop = listenAfterPage(scope, ['mouseover'], handler);
    over();
    stop();
    over();
    expect(handler).toHaveBeenCalledTimes(1);

    const other = vi.fn();
    listenAfterPage(scope, ['mouseover'], other);
    const halt = (event: Event): void => event.stopPropagation();
    document.addEventListener('mouseover', halt);
    over();
    scope.dispose();
    vi.runAllTimers();
    over();

    expect(other).not.toHaveBeenCalled();
    document.removeEventListener('mouseover', halt);
  });

  it('adds nothing for a scope already disposed', () => {
    scope.dispose();
    const handler = vi.fn();

    listenAfterPage(scope, ['mouseover'], handler);
    over();
    vi.runAllTimers();

    expect(handler).not.toHaveBeenCalled();
  });

  it('logs a handler that throws', () => {
    const log = createLogger('test');
    const error = vi.spyOn(log, 'error').mockImplementation(() => undefined);
    listenAfterPage(
      scope,
      ['mouseover'],
      () => {
        throw new Error('broken');
      },
      log,
    );

    over();
    over();

    expect(error).toHaveBeenCalledTimes(2);
    expect(heard).toEqual(['page', 'page']);
  });
});
