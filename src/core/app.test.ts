import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { FeatureStatus } from './app';
import type { FeatureDefinition, PageFactory } from './feature';
import type { OptionSpecs } from './options';
import { extensionStore } from '../platform/extension-store';
import { FAILURES_IN_A_ROW, FeatureRunner, startFeatures } from './app';
import { defineFeature } from './feature';
import { Listeners } from './listeners';
import { createLogger } from './log';
import { Options } from './options';
import { SavedData } from './saved';

describe('startFeatures', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('gives each feature its saved option values', async () => {
    await browser.storage.local.set({ 'u/options': { size: 12 } });
    const seen: number[] = [];
    const feature = defineFeature({
      id: 'sized',
      options: { size: { section: 'General', title: 'Size', description: '', default: 10 } },
      setup: ({ options }) => {
        seen.push(options.get('size'));
      },
    });
    expect(
      await startFeatures(
        [feature],
        new Options(extensionStore, 'u/options'),
        () => undefined,
        new SavedData(extensionStore, 'u'),
      ),
    ).toEqual([]);
    expect(seen).toEqual([12]);
  });

  it('keeps starting the other features when one throws', async () => {
    const started: string[] = [];
    const broken = defineFeature({
      id: 'broken',
      setup: () => {
        throw new Error('selector not found');
      },
    });
    const rejecting = defineFeature({
      id: 'rejecting',
      setup: () => Promise.reject(new Error('timed out')),
    });
    const working = defineFeature({
      id: 'working',
      setup: () => {
        started.push('working');
      },
    });
    const failed = await startFeatures(
      [broken, rejecting, working],
      new Options(extensionStore, 'u/options'),
      () => undefined,
      new SavedData(extensionStore, 'u'),
    );
    expect(failed).toEqual(['broken', 'rejecting']);
    expect(started).toEqual(['working']);
  });

  it('hands each feature the page it was given', async () => {
    const page = { name: 'a page' };
    const seen: unknown[] = [];
    const feature = defineFeature({
      id: 'curious',
      setup: (ctx: { page: typeof page }) => {
        seen.push(ctx.page);
      },
    });

    await startFeatures(
      [feature],
      new Options(extensionStore, 'u/options'),
      () => page,
      new SavedData(extensionStore, 'u'),
    );

    expect(seen).toEqual([page]);
  });
});

interface TickPage {
  onTick: (listener: (tick: number) => void) => () => void;
}

/** A page with one event, which the test fires with `ticks.emit`. */
function tickingPage() {
  const ticks = new Listeners<[number]>(createLogger('test'));
  const page: PageFactory<TickPage> = ({ listen }) => ({
    onTick: (listener) => listen((guarded) => ticks.add(guarded), listener),
  });
  return { ticks, page };
}

/** Declares a feature for the ticking page. */
const tickFeature = <S extends OptionSpecs = Record<never, never>>(
  feature: FeatureDefinition<S, TickPage>,
) => defineFeature(feature);

const SWITCH = {
  thing_enabled: { section: 'General', title: 'Thing', description: '', default: true },
  thing_size: { section: 'General', title: 'Size', description: '', default: 1 },
};

describe('feature lifecycle', () => {
  let options: Options;
  let data: SavedData;
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fakeBrowser.reset();
    error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    options = new Options(extensionStore, 'u/options');
    data = new SavedData(extensionStore, 'u');
  });

  it('ends what a feature subscribed to when it is switched off, and runs it again when switched on', async () => {
    const { ticks, page } = tickingPage();
    const heard = { size: vi.fn(), words: vi.fn(), tick: vi.fn() };
    const cleanup = vi.fn();
    const scopes: unknown[] = [];
    const feature = tickFeature({
      id: 'switched',
      options: SWITCH,
      enabledBy: 'thing_enabled',
      setup: ({ options: own, data: saved, page: ticking, scope }) => {
        scopes.push(scope);
        own.watch('thing_size', heard.size);
        saved.value('words', String).onChange(heard.words);
        ticking.onTick(heard.tick);
        scope.add(cleanup);
      },
    });
    // Read first, so the first read does not count as a change.
    await data.value('words', String).ready;
    const runner = new FeatureRunner([feature], options, page, data);
    expect(await runner.start()).toEqual([]);
    ticks.emit(1);
    expect(heard.tick).toHaveBeenCalledTimes(1);
    expect(heard.size).toHaveBeenCalledTimes(1);

    await options.set('thing_enabled', false);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(runner.statuses()[0]?.state).toBe('off');
    ticks.emit(2);
    await options.set('thing_size', 2);
    await data.value('words', String).set('a');
    expect(ticks.size).toBe(0);
    expect(heard.tick).toHaveBeenCalledTimes(1);
    expect(heard.size).toHaveBeenCalledTimes(1);
    expect(heard.words).not.toHaveBeenCalled();

    await options.set('thing_enabled', true);
    expect(scopes).toHaveLength(2);
    expect(scopes[1]).not.toBe(scopes[0]);
    expect(runner.statuses()[0]?.state).toBe('running');
    ticks.emit(3);
    expect(heard.tick).toHaveBeenCalledTimes(2);
  });

  it('lets a feature stop one subscription early', async () => {
    const { ticks, page } = tickingPage();
    const tick = vi.fn();
    const feature = tickFeature({
      id: 'brief',
      setup: (ctx) => {
        ctx.page.onTick(tick)();
      },
    });
    await startFeatures([feature], options, page, data);

    ticks.emit(1);

    expect(tick).not.toHaveBeenCalled();
    expect(ticks.size).toBe(0);
  });

  it('ends what a child context subscribed to when its scope is disposed', async () => {
    const { ticks, page } = tickingPage();
    const tick = vi.fn();
    const kept = vi.fn();
    const feature = tickFeature({
      id: 'parent',
      setup: (ctx) => {
        ctx.page.onTick(kept);
        const child = ctx.child();
        child.page.onTick(tick);
        child.scope.dispose();
      },
    });
    await startFeatures([feature], options, page, data);

    ticks.emit(1);

    expect(tick).not.toHaveBeenCalled();
    expect(kept).toHaveBeenCalledTimes(1);
  });

  it('stops a feature whose callbacks keep failing, and keeps the others running', async () => {
    const { ticks, page } = tickingPage();
    const working = vi.fn();
    const cleanup = vi.fn();
    const broken = tickFeature({
      id: 'broken',
      setup: (ctx) => {
        ctx.scope.add(cleanup);
        ctx.page.onTick(() => {
          throw new Error('selector not found');
        });
      },
    });
    const fine = tickFeature({
      id: 'fine',
      setup: (ctx) => {
        ctx.page.onTick(working);
      },
    });
    const runner = new FeatureRunner([broken, fine], options, page, data);
    await runner.start();

    for (let tick = 1; tick < FAILURES_IN_A_ROW; tick++) {
      ticks.emit(tick);
    }
    expect(runner.statuses()[0]?.state).toBe('running');
    ticks.emit(FAILURES_IN_A_ROW);
    ticks.emit(FAILURES_IN_A_ROW + 1);

    expect(runner.statuses()).toEqual([
      {
        id: 'broken',
        state: 'failed',
        errors: FAILURES_IN_A_ROW,
        lastError: 'selector not found',
      },
      { id: 'fine', state: 'running', errors: 0, lastError: null },
    ]);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(working).toHaveBeenCalledTimes(FAILURES_IN_A_ROW + 1);
    expect(ticks.size).toBe(1);
    const stopped = error.mock.calls.filter((call: unknown[]) =>
      String(call[1]).includes('stopped'),
    );
    expect(stopped).toHaveLength(1);
  });

  it('stops a feature whose async callbacks keep rejecting', async () => {
    const { ticks, page } = tickingPage();
    const feature = tickFeature({
      id: 'async_broken',
      setup: (ctx) => {
        ctx.page.onTick(async () => {
          throw new Error('timed out');
        });
      },
    });
    const runner = new FeatureRunner([feature], options, page, data);
    await runner.start();

    for (let tick = 1; tick <= FAILURES_IN_A_ROW; tick++) {
      ticks.emit(tick);
      await Promise.resolve();
    }

    await vi.waitFor(() => expect(runner.statuses()[0]?.state).toBe('failed'));
  });

  it('reports a feature as failed when its callbacks stop it during setup', async () => {
    const { ticks, page } = tickingPage();
    const feature = tickFeature({
      id: 'fails_at_once',
      setup: (ctx) => {
        ctx.page.onTick(() => {
          throw new Error('selector not found');
        });
        for (let tick = 1; tick <= FAILURES_IN_A_ROW; tick++) {
          ticks.emit(tick);
        }
      },
    });

    await expect(startFeatures([feature], options, page, data)).resolves.toEqual(['fails_at_once']);
  });

  it('keeps a feature running when its errors come among calls that work', async () => {
    const { ticks, page } = tickingPage();
    const feature = tickFeature({
      id: 'one_bad_post',
      setup: (ctx) => {
        ctx.page.onTick((tick) => {
          if (tick % 2 === 0) {
            throw new Error(`bad post ${tick}`);
          }
        });
      },
    });
    const runner = new FeatureRunner([feature], options, page, data);
    await runner.start();

    for (let tick = 1; tick <= FAILURES_IN_A_ROW * 4; tick++) {
      ticks.emit(tick);
    }

    expect(runner.statuses()).toEqual([
      {
        id: 'one_bad_post',
        state: 'running',
        errors: FAILURES_IN_A_ROW * 2,
        lastError: `bad post ${FAILURES_IN_A_ROW * 4}`,
      },
    ]);
  });

  it('gives a failed feature another go when its switch is turned off and on', async () => {
    const setup = vi.fn<() => void>(() => {
      throw new Error('not yet');
    });
    const feature = defineFeature({
      id: 'retried',
      options: SWITCH,
      enabledBy: 'thing_enabled',
      setup,
    });
    const runner = new FeatureRunner([feature], options, () => undefined, data);
    expect(await runner.start()).toEqual(['retried']);
    expect(runner.statuses()[0]?.state).toBe('failed');

    setup.mockImplementation(() => undefined);
    await options.set('thing_enabled', false);
    expect(runner.statuses()[0]?.state).toBe('off');
    await options.set('thing_enabled', true);

    expect(setup).toHaveBeenCalledTimes(2);
    expect(runner.statuses()[0]).toEqual({
      id: 'retried',
      state: 'running',
      errors: 1,
      lastError: 'not yet',
    });
  });

  it('does not run a feature that starts switched off', async () => {
    await browser.storage.local.set({ 'u/options': { thing_enabled: false } });
    const setup = vi.fn();
    const feature = defineFeature({
      id: 'idle',
      options: SWITCH,
      enabledBy: 'thing_enabled',
      setup,
    });
    const runner = new FeatureRunner([feature], options, () => undefined, data);

    expect(await runner.start()).toEqual([]);

    expect(setup).not.toHaveBeenCalled();
    expect(runner.statuses()[0]?.state).toBe('off');
  });

  it('tells listeners when a status changes', async () => {
    const seen: FeatureStatus[] = [];
    const feature = defineFeature({
      id: 'watched',
      options: SWITCH,
      enabledBy: 'thing_enabled',
      setup: () => undefined,
    });
    const runner = new FeatureRunner([feature], options, () => undefined, data);
    runner.onStatusChange((status) => seen.push(status));

    await runner.start();
    await options.set('thing_enabled', false);

    expect(seen.map((status) => status.state)).toEqual(['running', 'off']);
  });
});
