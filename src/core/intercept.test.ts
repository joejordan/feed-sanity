import { afterEach, describe, expect, it, vi } from 'vitest';
import { intercept } from './intercept';
import { createLogger } from './log';
import { Scope } from './scope';

describe('intercept', () => {
  const onPage = vi.fn();
  let scope: Scope;

  const click = (): void => {
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  };

  afterEach(() => {
    scope.dispose();
    document.removeEventListener('click', onPage, true);
    onPage.mockReset();
  });

  const start = (handler: (event: MouseEvent) => boolean) => {
    scope = new Scope();
    document.addEventListener('click', onPage, true);
    return intercept(scope, ['click'], handler);
  };

  it('stops an event before the page hears it when the handler says so', () => {
    const seen: string[] = [];
    start((event) => {
      seen.push(event.type);
      return true;
    });
    addEventListener('click', onPage, true);

    click();

    expect(seen).toEqual(['click']);
    expect(onPage).not.toHaveBeenCalled();
    removeEventListener('click', onPage, true);
  });

  it('lets an event through when the handler does not stop it', () => {
    start(() => false);

    click();

    expect(onPage).toHaveBeenCalledTimes(1);
  });

  it('stops listening when the scope is disposed or when asked to', () => {
    const handler = vi.fn(() => true);
    const stop = start(handler);
    click();
    stop();
    click();
    expect(handler).toHaveBeenCalledTimes(1);

    const other = vi.fn(() => true);
    intercept(scope, ['click'], other);
    scope.dispose();
    click();
    expect(other).not.toHaveBeenCalled();
    expect(onPage).toHaveBeenCalledTimes(2);
  });

  it('adds nothing for a scope already disposed', () => {
    scope = new Scope();
    scope.dispose();
    const handler = vi.fn(() => true);

    intercept(scope, ['click'], handler);
    click();

    expect(handler).not.toHaveBeenCalled();
  });

  it('logs a handler that throws and lets the event through', () => {
    const log = createLogger('test');
    const error = vi.spyOn(log, 'error').mockImplementation(() => undefined);
    scope = new Scope();
    document.addEventListener('click', onPage, true);
    intercept(
      scope,
      ['click'],
      () => {
        throw new Error('broken');
      },
      log,
    );

    click();

    expect(error).toHaveBeenCalledTimes(1);
    expect(onPage).toHaveBeenCalledTimes(1);
  });
});
