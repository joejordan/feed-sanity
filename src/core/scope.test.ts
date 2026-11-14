import { describe, expect, it, vi } from 'vitest';
import { Scope } from './scope';

describe('Scope', () => {
  it('runs the cleanups the last one first, once', () => {
    const order: string[] = [];
    const scope = new Scope();
    scope.add(() => order.push('first'));
    scope.add(() => order.push('second'));

    scope.dispose();
    scope.dispose();

    expect(order).toEqual(['second', 'first']);
    expect(scope.disposed).toBe(true);
  });

  it('runs the other cleanups when one throws', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const cleanup = vi.fn();
    const scope = new Scope();
    scope.add(cleanup);
    scope.add(() => {
      throw new Error('broken cleanup');
    });

    scope.dispose();

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('runs a cleanup added after it was disposed at once', () => {
    const scope = new Scope();
    scope.dispose();
    const cleanup = vi.fn();

    scope.add(cleanup)();

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('runs a cleanup early when asked, and not again on dispose', () => {
    const scope = new Scope();
    const cleanup = vi.fn();
    const early = scope.add(cleanup);

    early();
    early();
    scope.dispose();

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('runs the same function as often as it was added', () => {
    const scope = new Scope();
    const cleanup = vi.fn();
    scope.add(cleanup);
    scope.add(cleanup);

    scope.dispose();

    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it('disposes a child with its parent', () => {
    const parent = new Scope();
    const child = parent.child();
    const cleanup = vi.fn();
    child.add(cleanup);

    parent.dispose();

    expect(child.disposed).toBe(true);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('lets a child be disposed on its own, without touching the parent', () => {
    const parent = new Scope();
    const kept = vi.fn();
    parent.add(kept);
    const child = parent.child();
    const cleanup = vi.fn();
    child.add(cleanup);

    child.dispose();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(parent.disposed).toBe(false);
    expect(kept).not.toHaveBeenCalled();

    parent.dispose();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(kept).toHaveBeenCalledTimes(1);
  });

  it('gives a disposed parent only disposed children', () => {
    const parent = new Scope();
    parent.dispose();

    expect(parent.child().disposed).toBe(true);
  });
});
