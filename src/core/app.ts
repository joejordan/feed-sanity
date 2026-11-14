import type { Binder, Feature, FeatureContext, PageFactory } from './feature';
import type { Logger } from './log';
import type { FeatureOptions, OptionSpecs, Options } from './options';
import type { FeatureData } from './saved';
import { Listeners } from './listeners';
import { createLogger } from './log';
import { Scope } from './scope';

/**
 * A feature is stopped once its callbacks have thrown this many times with
 * no call between them that went through. A feature that Facebook broke
 * fails on every post, while one odd post fails among others that work.
 */
export const FAILURES_IN_A_ROW = 10;

export type FeatureState = 'failed' | 'off' | 'running';

export interface FeatureStatus {
  readonly id: string;
  readonly state: FeatureState;
  /** How many errors its setup and callbacks have thrown since the page loaded. */
  readonly errors: number;
  readonly lastError: string | null;
}

const noop = (): void => undefined;

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** The options as a feature sees them, with `watch` tied to the binder's scope. */
function bindOptions(options: Options, { listen }: Binder): FeatureOptions<OptionSpecs> {
  return {
    get: (key) => options.get(key),
    set: (key, value) => options.set(key, value),
    watch: (key, listener) => listen((guarded) => options.watch(key, guarded), listener),
  };
}

/** The saved data as a feature sees it, with `onChange` tied to the binder's scope. */
function bindData(data: FeatureData, { listen }: Binder): FeatureData {
  return {
    value: (name, read) => {
      const saved = data.value(name, read);
      return {
        get: () => saved.get(),
        set: (value) => saved.set(value),
        ready: saved.ready,
        onChange: (listener) => listen((guarded) => saved.onChange(guarded), listener),
      };
    },
  };
}

/** One feature: whether it runs, its scope while it does, and the errors it has thrown. */
class FeatureRun<P> {
  readonly feature: Feature<P>;
  status: FeatureStatus;
  readonly #log: Logger;
  readonly #options: Options;
  readonly #data: FeatureData;
  readonly #page: PageFactory<P>;
  readonly #reportStatus: (status: FeatureStatus) => void;
  /** The scope of the setup now running, if any. */
  #scope: Scope | undefined;
  #failuresInARow = 0;

  constructor(
    feature: Feature<P>,
    options: Options,
    data: FeatureData,
    page: PageFactory<P>,
    reportStatus: (status: FeatureStatus) => void,
  ) {
    this.feature = feature;
    this.status = { id: feature.id, state: 'off', errors: 0, lastError: null };
    this.#log = createLogger(feature.id);
    this.#options = options;
    this.#data = data;
    this.#page = page;
    this.#reportStatus = reportStatus;
  }

  /**
   * Runs the feature, or with `enabledBy` starts following its switch.
   * Resolves false when the first setup failed.
   */
  begin(): Promise<boolean> {
    const key: string | undefined = this.feature.enabledBy;
    if (key === undefined) {
      return this.#run();
    }
    try {
      if (typeof this.#options.get(key) !== 'boolean') {
        throw new Error(`'${key}' is not an on and off option`);
      }
    } catch (error) {
      this.#log.error('cannot be switched on', error);
      this.#update({
        state: 'failed',
        errors: this.status.errors + 1,
        lastError: messageOf(error),
      });
      return Promise.resolve(false);
    }
    let first = Promise.resolve(true);
    this.#options.watch(key, (on) => {
      if (!on) {
        this.#end('off');
      } else if (!this.#scope) {
        first = this.#run();
      }
    });
    return first;
  }

  async #run(): Promise<boolean> {
    const scope = new Scope(this.#log);
    this.#scope = scope;
    this.#failuresInARow = 0;
    this.#update({ state: 'running' });
    try {
      await this.feature.setup(this.#context(scope));
      // Callbacks that kept failing during setup have already stopped it.
      return !scope.disposed || this.status.state !== 'failed';
    } catch (error) {
      this.#log.error('failed to start', error);
      this.#update({ errors: this.status.errors + 1, lastError: messageOf(error) });
      // A run switched off while it was starting has nothing left to stop.
      if (this.#scope === scope) {
        this.#end('failed');
      }
      return false;
    }
  }

  #end(state: FeatureState): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#update({ state });
  }

  #context(scope: Scope): FeatureContext<OptionSpecs, P> {
    const guard = this.#guard(scope);
    const binder: Binder = {
      scope,
      guard,
      listen: (subscribe, listener) =>
        scope.disposed ? noop : scope.add(subscribe(guard(listener))),
    };
    return {
      options: bindOptions(this.#options, binder),
      data: bindData(this.#data, binder),
      log: this.#log,
      page: this.#page(binder),
      scope,
      child: () => this.#context(scope.child()),
    };
  }

  #guard(scope: Scope): Binder['guard'] {
    return (callback) =>
      (...args) => {
        if (scope.disposed) {
          return;
        }
        let result: unknown;
        try {
          result = callback(...args);
        } catch (error) {
          this.#callbackFailed(scope, error);
          return;
        }
        // An async callback has gone through only once its promise resolves.
        if (result instanceof Promise) {
          result.then(
            () => this.#callbackSucceeded(scope),
            (error: unknown) => this.#callbackFailed(scope, error),
          );
        } else {
          this.#callbackSucceeded(scope);
        }
      };
  }

  #callbackSucceeded(scope: Scope): void {
    if (!scope.disposed) {
      this.#failuresInARow = 0;
    }
  }

  #callbackFailed(scope: Scope, error: unknown): void {
    // An error from work that was already stopped says nothing about the feature now.
    if (scope.disposed) {
      return;
    }
    this.#log.error('a callback failed', error);
    this.#failuresInARow++;
    this.#update({ errors: this.status.errors + 1, lastError: messageOf(error) });
    if (this.#failuresInARow >= FAILURES_IN_A_ROW) {
      this.#log.error(`stopped after ${FAILURES_IN_A_ROW} errors in a row`);
      this.#end('failed');
    }
  }

  #update(changes: Partial<FeatureStatus>): void {
    const status = { ...this.status, ...changes };
    if (
      status.state === this.status.state &&
      status.errors === this.status.errors &&
      status.lastError === this.status.lastError
    ) {
      return;
    }
    this.status = status;
    this.#reportStatus(status);
  }
}

/**
 * Runs a list of features and keeps track of each one's state.
 *
 * Each feature gets its own scope and its own view of the options, the saved
 * data and the page, so that what it subscribes to ends with its scope. A
 * feature whose callbacks keep throwing is stopped and marked as failed,
 * and the others keep running.
 */
export class FeatureRunner<P> {
  readonly #options: Options;
  readonly #runs: FeatureRun<P>[];
  readonly #listeners = new Listeners<[FeatureStatus]>(createLogger('features'));

  constructor(
    features: readonly Feature<P>[],
    options: Options,
    page: PageFactory<P>,
    data: FeatureData,
  ) {
    this.#options = options;
    this.#runs = features.map(
      (feature) =>
        new FeatureRun(feature, options, data, page, (status) => this.#listeners.emit(status)),
    );
  }

  /**
   * Registers every feature's options, reads the saved values, then starts
   * the features in list order. A feature that throws is reported and
   * skipped, so one feature broken by a Facebook change does not take the
   * others down. Resolves with the ids of the features that failed to start.
   * Call it once.
   */
  async start(): Promise<string[]> {
    for (const { feature } of this.#runs) {
      if (feature.options) {
        this.#options.register(feature.options);
      }
    }
    await this.#options.load();

    const failed: string[] = [];
    await Promise.all(
      this.#runs.map(async (run) => {
        if (!(await run.begin())) {
          failed.push(run.feature.id);
        }
      }),
    );
    return failed;
  }

  /** The status of every feature, in list order. */
  statuses(): FeatureStatus[] {
    return this.#runs.map((run) => run.status);
  }

  /** Calls `listener` with a feature's new status whenever it changes. Returns a function that stops it. */
  onStatusChange(listener: (status: FeatureStatus) => void): () => void {
    return this.#listeners.add(listener);
  }
}

/**
 * Starts the features with a `FeatureRunner` and resolves with the ids of
 * the ones that failed to start. `page` builds each feature's view of the
 * page services.
 */
export function startFeatures<P>(
  features: readonly Feature<P>[],
  options: Options,
  page: PageFactory<P>,
  data: FeatureData,
): Promise<string[]> {
  return new FeatureRunner(features, options, page, data).start();
}
