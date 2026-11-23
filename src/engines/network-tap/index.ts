// Zero-global MAIN-world network tap for `fetch` and `XMLHttpRequest`.
// Installed lazily when the first rule is registered (typically at
// `document_start` for sites whose structured truth arrives over GraphQL or
// REST APIs: Instagram, X.com, TikTok, Gmail) and restores host originals when
// the last rule is removed or `dispose()` runs.
//
// Read-only observers clone responses off the critical path so the host app
// never sees a consumed body. Request/response transformers are opt-in per
// rule and never touch auth headers unless a rule explicitly rewrites them.

export interface NetworkRequestInfo {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
}

export interface NetworkResponseInfo extends NetworkRequestInfo {
  readonly status: number;
  readonly text: string;
}

export interface NetworkRule {
  /** Stable identifier for diagnostics. */
  readonly id: string;
  /** Fast filter; return true only for requests this rule cares about. */
  readonly match: (url: string, method: string) => boolean;
  /** Passive read-only observer invoked with response text off the critical path. */
  readonly onResponse?: (info: NetworkResponseInfo) => void;
  /** Optional request body transformer (e.g., rewriting GraphQL variables). Return undefined to leave untouched. */
  readonly transformRequestBody?: (info: NetworkRequestInfo) => string | undefined;
  /** Optional response text transformer (e.g., stripping promoted entries before render). Return undefined to leave untouched. */
  readonly transformResponseText?: (info: NetworkResponseInfo) => string | undefined;
}

export interface NetworkTapHost {
  fetch?: typeof globalThis.fetch;
  XMLHttpRequest?: typeof globalThis.XMLHttpRequest;
}

export type NetworkTapPhase =
  | 'match'
  | 'transformRequestBody'
  | 'onResponse'
  | 'transformResponseText';

export interface NetworkTapError {
  readonly ruleId: string;
  readonly phase: NetworkTapPhase;
  readonly error: unknown;
}

export interface NetworkRuleStats {
  readonly matched: number;
  readonly transformed: number;
  readonly errors: number;
}

export interface NetworkTapStats {
  readonly active: boolean;
  readonly totalMatched: number;
  readonly totalTransformed: number;
  readonly totalErrors: number;
  readonly rules: Readonly<Record<string, NetworkRuleStats>>;
}

export interface NetworkTapOptions {
  /** Optional error sink invoked when a rule matcher, observer, or transformer throws. */
  readonly onError?: (info: NetworkTapError) => void;
}

export interface NetworkTap {
  /** Registers a rule, installing the fetch/XHR hooks if not yet active. Returns an unsubscribe function. */
  addRule: (rule: NetworkRule) => () => void;
  /** Removes all rules and restores the host's original `fetch` and `XMLHttpRequest` methods. */
  dispose: () => void;
  /** True while the hooks are currently installed on the host. */
  isActive: () => boolean;
  /** Snapshot of per-rule match, transformation, and error counts for diagnostics. */
  stats: () => NetworkTapStats;
}

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

function resolveUrl(input: unknown): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  if (typeof input === 'object' && input !== null && 'url' in input) {
    const candidate = (input as { url?: unknown }).url;
    if (typeof candidate === 'string') {
      return candidate;
    }
  }
  return String(input);
}

function resolveMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) {
    return init.method.toUpperCase();
  }
  if (typeof input !== 'string' && !(input instanceof URL) && input.method) {
    return input.method.toUpperCase();
  }
  return 'GET';
}

interface MutableRuleStats {
  matched: number;
  transformed: number;
  errors: number;
}

interface TapAccounting {
  recordMatched: (ruleId: string) => void;
  recordTransformed: (ruleId: string) => void;
  recordError: (ruleId: string, phase: NetworkTapPhase, error: unknown) => void;
}

function applyRequestTransforms(
  matched: readonly NetworkRule[],
  url: string,
  method: string,
  initialBody: unknown,
  accounting: TapAccounting,
): { body: unknown; changed: boolean } {
  let body = initialBody;
  let changed = false;
  for (const rule of matched) {
    if (!rule.transformRequestBody) {
      continue;
    }
    try {
      const rewritten = rule.transformRequestBody({ url, method, body });
      if (rewritten !== undefined) {
        body = rewritten;
        changed = true;
        accounting.recordTransformed(rule.id);
      }
    } catch (error) {
      // Never break host requests on transformer failure.
      accounting.recordError(rule.id, 'transformRequestBody', error);
    }
  }
  return { body, changed };
}

function notifyObserver(
  rule: NetworkRule,
  info: NetworkResponseInfo,
  accounting: TapAccounting,
): void {
  if (!rule.onResponse) {
    return;
  }
  try {
    rule.onResponse(info);
  } catch (error) {
    // Ignore observer failures while recording telemetry.
    accounting.recordError(rule.id, 'onResponse', error);
  }
}

function notifyObservers(
  matched: readonly NetworkRule[],
  info: NetworkResponseInfo,
  accounting: TapAccounting,
): void {
  for (const rule of matched) {
    notifyObserver(rule, info, accounting);
  }
}

function applyResponseTransforms(
  matched: readonly NetworkRule[],
  base: Omit<NetworkResponseInfo, 'text'>,
  initialText: string,
  accounting: TapAccounting,
): { text: string; mutated: boolean } {
  let text = initialText;
  let mutated = false;
  for (const rule of matched) {
    const info: NetworkResponseInfo = { ...base, text };
    notifyObserver(rule, info, accounting);
    if (rule.transformResponseText) {
      try {
        const next = rule.transformResponseText(info);
        if (next !== undefined && next !== text) {
          text = next;
          mutated = true;
          accounting.recordTransformed(rule.id);
        }
      } catch (error) {
        // Keep previous text on transformer failure.
        accounting.recordError(rule.id, 'transformResponseText', error);
      }
    }
  }
  return { text, mutated };
}

/**
 * Creates a reversible, zero-global `fetch` + `XMLHttpRequest` tap bound to
 * `host` (defaults to `globalThis`). Safe to instantiate in MAIN world at
 * `document_start`; touches nothing until `addRule` is called.
 *
 * Supports `transformRequestBody`, `transformResponseText`, and read-only
 * `onResponse` across both `fetch` and `XMLHttpRequest`, with per-rule stats
 * and optional `onError` observability.
 */
export function createNetworkTap(
  host: NetworkTapHost = globalThis,
  options: NetworkTapOptions = {},
): NetworkTap {
  const rules = new Set<NetworkRule>();
  const ruleStats = new Map<string, MutableRuleStats>();
  let origFetch: typeof globalThis.fetch | undefined;
  let installedFetch: typeof globalThis.fetch | undefined;
  let origXhrOpen: typeof XMLHttpRequest.prototype.open | undefined;
  let installedXhrOpen: typeof XMLHttpRequest.prototype.open | undefined;
  let origXhrSend: typeof XMLHttpRequest.prototype.send | undefined;
  let installedXhrSend: typeof XMLHttpRequest.prototype.send | undefined;
  let deactivate: (() => void) | undefined;
  let installed = false;

  const ensureStat = (ruleId: string): MutableRuleStats => {
    let entry = ruleStats.get(ruleId);
    if (!entry) {
      entry = { matched: 0, transformed: 0, errors: 0 };
      ruleStats.set(ruleId, entry);
    }
    return entry;
  };

  const accounting: TapAccounting = {
    recordMatched(ruleId) {
      ensureStat(ruleId).matched++;
    },
    recordTransformed(ruleId) {
      ensureStat(ruleId).transformed++;
    },
    recordError(ruleId, phase, error) {
      ensureStat(ruleId).errors++;
      if (options.onError) {
        try {
          options.onError({ ruleId, phase, error });
        } catch {
          // Never break host calls if an error observer throws.
        }
      }
    },
  };

  const xhrMeta = new WeakMap<XMLHttpRequest, { url: string; method: string }>();
  const shadowedXhrs = new WeakSet<XMLHttpRequest>();

  const matchingRules = (url: string, method: string): NetworkRule[] | undefined => {
    let matched: NetworkRule[] | undefined;
    for (const rule of rules) {
      try {
        if (rule.match(url, method)) {
          accounting.recordMatched(rule.id);
          matched ??= [];
          matched.push(rule);
        }
      } catch (error) {
        // Ignore broken matcher so host network calls never fail.
        accounting.recordError(rule.id, 'match', error);
      }
    }
    return matched;
  };

  const handleMatchedFetch = async (
    baseFetch: typeof globalThis.fetch,
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    url: string,
    method: string,
    matched: readonly NetworkRule[],
  ): Promise<Response> => {
    const isRequestObj = typeof Request !== 'undefined' && input instanceof Request;
    const hasRequestTransformer = matched.some((rule) => rule.transformRequestBody !== undefined);
    let initialBody: unknown = init?.body;
    let bodyFromRequest = false;
    if (initialBody === undefined && isRequestObj && input.body !== null && hasRequestTransformer) {
      try {
        initialBody = await input.clone().text();
        bodyFromRequest = true;
      } catch {
        // Leave initialBody undefined if the Request body cannot be cloned as text.
      }
    }
    const { body, changed } = applyRequestTransforms(matched, url, method, initialBody, accounting);
    let nextInput: RequestInfo | URL = input;
    let nextInit: RequestInit | undefined = init;
    if (changed) {
      if (bodyFromRequest && isRequestObj) {
        const headers = new Headers(input.headers);
        headers.delete('content-length');
        const rebuiltInit: RequestInit = {
          method: input.method,
          headers,
          credentials: input.credentials,
          cache: input.cache,
          redirect: input.redirect,
          referrer: input.referrer,
          referrerPolicy: input.referrerPolicy,
          integrity: input.integrity,
          keepalive: input.keepalive,
          signal: input.signal,
          ...(input.mode === 'navigate' ? {} : { mode: input.mode }),
          ...init,
          body: body as BodyInit,
        };
        nextInput = new Request(input.url, rebuiltInit);
        nextInit = undefined;
      } else {
        nextInit = { ...init, body: body as BodyInit };
      }
    }
    const response = await baseFetch.call(host, nextInput, nextInit);

    const hasTransformer = matched.some((rule) => rule.transformResponseText !== undefined);
    const hasObserver = matched.some((rule) => rule.onResponse !== undefined);

    if (hasTransformer) {
      let initialText: string;
      try {
        initialText = await response.clone().text();
      } catch {
        return response;
      }
      const { text, mutated } = applyResponseTransforms(
        matched,
        { url, method, body, status: response.status },
        initialText,
        accounting,
      );
      if (!mutated || response.status === 0 || NULL_BODY_STATUSES.has(response.status)) {
        return response;
      }
      try {
        const headers = new Headers(response.headers);
        headers.delete('content-length');
        headers.delete('content-encoding');
        const rebuilt = new Response(text, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
        Object.defineProperties(rebuilt, {
          url: { value: response.url, configurable: true },
          redirected: { value: response.redirected, configurable: true },
          type: { value: response.type, configurable: true },
        });
        void response.body?.cancel().catch(() => undefined);
        return rebuilt;
      } catch {
        return response;
      }
    }

    if (hasObserver) {
      void response
        .clone()
        .text()
        .then((text) =>
          notifyObservers(
            matched,
            { url, method, body, status: response.status, text },
            accounting,
          ),
        )
        .catch(() => undefined);
    }
    return response;
  };

  const install = (): void => {
    if (installed) {
      return;
    }
    installed = true;
    let active = true;
    deactivate = () => {
      active = false;
    };

    if (typeof host.fetch === 'function') {
      const baseFetch = host.fetch;
      origFetch = baseFetch;
      // Stay synchronous for unmatched requests to avoid extra Promise hops.
      const wrappedFetch = function tappedFetch(
        input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> {
        if (!active) {
          return baseFetch.call(host, input, init);
        }
        const url = resolveUrl(input);
        const method = resolveMethod(input, init);
        const matched = matchingRules(url, method);
        if (!matched) {
          return baseFetch.call(host, input, init);
        }
        return handleMatchedFetch(baseFetch, input, init, url, method, matched);
      };
      installedFetch = wrappedFetch;
      host.fetch = wrappedFetch;
    }

    const XHR = host.XMLHttpRequest;
    if (typeof XHR === 'function' && XHR.prototype) {
      const baseOpen = XHR.prototype.open;
      const baseSend = XHR.prototype.send;
      origXhrOpen = baseOpen;
      origXhrSend = baseSend;

      const wrappedOpen = function tappedOpen(this: XMLHttpRequest, ...args: unknown[]): void {
        if (shadowedXhrs.has(this)) {
          shadowedXhrs.delete(this);
          Reflect.deleteProperty(this, 'responseText');
          Reflect.deleteProperty(this, 'response');
        }
        if (active) {
          const [method, url] = args;
          xhrMeta.set(this, {
            url: resolveUrl(url),
            method: String(method).toUpperCase(),
          });
        }
        return Reflect.apply(baseOpen, this, args) as void;
      } as typeof XMLHttpRequest.prototype.open;
      installedXhrOpen = wrappedOpen;
      XHR.prototype.open = wrappedOpen;

      const wrappedSend = function tappedSend(
        this: XMLHttpRequest,
        body?: Document | XMLHttpRequestBodyInit | null,
      ): void {
        if (!active) {
          return baseSend.call(this, body);
        }
        const meta = xhrMeta.get(this);
        if (!meta) {
          return baseSend.call(this, body);
        }
        const matched = matchingRules(meta.url, meta.method);
        if (!matched) {
          return baseSend.call(this, body);
        }
        const { body: nextBody } = applyRequestTransforms(
          matched,
          meta.url,
          meta.method,
          body,
          accounting,
        );
        const hasResponseTransformer = matched.some(
          (rule) => rule.transformResponseText !== undefined,
        );
        const hasObserver = matched.some((rule) => rule.onResponse !== undefined);

        if (hasResponseTransformer) {
          const proto = Object.getPrototypeOf(this) as XMLHttpRequest;
          const nativeTextDesc = Object.getOwnPropertyDescriptor(proto, 'responseText');
          const nativeRespDesc = Object.getOwnPropertyDescriptor(proto, 'response');
          const readNativeText = (): string =>
            nativeTextDesc?.get
              ? String(nativeTextDesc.get.call(this) ?? '')
              : String(Reflect.get(proto, 'responseText', this) ?? '');
          const readNativeResp = (): unknown =>
            nativeRespDesc?.get
              ? nativeRespDesc.get.call(this)
              : Reflect.get(proto, 'response', this);

          let computed = false;
          let transformedText: string | undefined;
          let transformedJson: unknown;
          let hasTransformedJson = false;

          const ensureTransformed = (): void => {
            if (computed || this.readyState !== 4 || this.status === 0) {
              return;
            }
            computed = true;
            const rType = this.responseType;
            if (rType !== '' && rType !== 'text' && rType !== 'json') {
              return;
            }
            let rawText: string;
            try {
              if (rType === 'json') {
                const rawJson = readNativeResp();
                if (rawJson === null || rawJson === undefined) {
                  return;
                }
                rawText = JSON.stringify(rawJson);
              } else {
                rawText = readNativeText();
              }
            } catch {
              return;
            }
            const { text, mutated } = applyResponseTransforms(
              matched,
              { url: meta.url, method: meta.method, body: nextBody, status: this.status },
              rawText,
              accounting,
            );
            if (mutated) {
              transformedText = text;
              if (rType === 'json') {
                try {
                  transformedJson = JSON.parse(text);
                  hasTransformedJson = true;
                } catch {
                  hasTransformedJson = false;
                }
              }
            }
          };

          shadowedXhrs.add(this);
          Object.defineProperty(this, 'responseText', {
            configurable: true,
            get: () => {
              ensureTransformed();
              return transformedText === undefined ? readNativeText() : transformedText;
            },
          });
          Object.defineProperty(this, 'response', {
            configurable: true,
            get: () => {
              ensureTransformed();
              if (this.responseType === 'json' && hasTransformedJson) {
                return transformedJson;
              }
              if (
                (this.responseType === '' || this.responseType === 'text') &&
                transformedText !== undefined
              ) {
                return transformedText;
              }
              return readNativeResp();
            },
          });
          // Ensure observers and stats run even if the caller ignores `responseText`.
          this.addEventListener('loadend', () => ensureTransformed(), { once: true });
        } else if (hasObserver) {
          // Use `loadend` so aborted or errored XHRs never leak stale listeners.
          this.addEventListener(
            'loadend',
            () => {
              if (this.status === 0) {
                return;
              }
              let text: string;
              try {
                text = typeof this.responseText === 'string' ? this.responseText : '';
              } catch {
                return;
              }
              notifyObservers(
                matched,
                {
                  url: meta.url,
                  method: meta.method,
                  body: nextBody,
                  status: this.status,
                  text,
                },
                accounting,
              );
            },
            { once: true },
          );
        }
        return baseSend.call(this, nextBody as Document | XMLHttpRequestBodyInit | null);
      };
      installedXhrSend = wrappedSend;
      XHR.prototype.send = wrappedSend;
    }
  };

  const uninstall = (): void => {
    if (!installed) {
      return;
    }
    installed = false;
    deactivate?.();
    deactivate = undefined;
    if (origFetch) {
      if (host.fetch === installedFetch) {
        host.fetch = origFetch;
      }
      origFetch = undefined;
      installedFetch = undefined;
    }
    const XHR = host.XMLHttpRequest;
    if (XHR?.prototype) {
      if (origXhrOpen) {
        if (XHR.prototype.open === installedXhrOpen) {
          XHR.prototype.open = origXhrOpen;
        }
        origXhrOpen = undefined;
        installedXhrOpen = undefined;
      }
      if (origXhrSend) {
        if (XHR.prototype.send === installedXhrSend) {
          XHR.prototype.send = origXhrSend;
        }
        origXhrSend = undefined;
        installedXhrSend = undefined;
      }
    }
  };

  return {
    addRule(rule) {
      rules.add(rule);
      ensureStat(rule.id);
      install();
      let removed = false;
      return () => {
        if (removed) {
          return;
        }
        removed = true;
        rules.delete(rule);
        if (rules.size === 0) {
          uninstall();
        }
      };
    },
    dispose() {
      rules.clear();
      uninstall();
    },
    isActive: () => installed,
    stats() {
      let totalMatched = 0;
      let totalTransformed = 0;
      let totalErrors = 0;
      const snapshot: Record<string, NetworkRuleStats> = {};
      for (const [id, entry] of ruleStats) {
        totalMatched += entry.matched;
        totalTransformed += entry.transformed;
        totalErrors += entry.errors;
        snapshot[id] = { ...entry };
      }
      return {
        active: installed,
        totalMatched,
        totalTransformed,
        totalErrors,
        rules: snapshot,
      };
    },
  };
}
