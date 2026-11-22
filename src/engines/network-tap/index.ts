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

export interface NetworkTap {
  /** Registers a rule, installing the fetch/XHR hooks if not yet active. Returns an unsubscribe function. */
  addRule: (rule: NetworkRule) => () => void;
  /** Removes all rules and restores the host's original `fetch` and `XMLHttpRequest` methods. */
  dispose: () => void;
  /** True while the hooks are currently installed on the host. */
  isActive: () => boolean;
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

function applyRequestTransforms(
  matched: readonly NetworkRule[],
  url: string,
  method: string,
  initialBody: unknown,
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
      }
    } catch {
      // Never break host requests on transformer failure.
    }
  }
  return { body, changed };
}

function notifyObserver(rule: NetworkRule, info: NetworkResponseInfo): void {
  if (!rule.onResponse) {
    return;
  }
  try {
    rule.onResponse(info);
  } catch {
    // Ignore observer failures.
  }
}

function notifyObservers(matched: readonly NetworkRule[], info: NetworkResponseInfo): void {
  for (const rule of matched) {
    notifyObserver(rule, info);
  }
}

/**
 * Creates a reversible, zero-global `fetch` + `XMLHttpRequest` tap bound to
 * `host` (defaults to `globalThis`). Safe to instantiate in MAIN world at
 * `document_start`; touches nothing until `addRule` is called.
 *
 * Supports `transformRequestBody`, `transformResponseText`, and read-only
 * `onResponse` across both `fetch` and `XMLHttpRequest`.
 */
export function createNetworkTap(host: NetworkTapHost = globalThis): NetworkTap {
  const rules = new Set<NetworkRule>();
  let origFetch: typeof globalThis.fetch | undefined;
  let installedFetch: typeof globalThis.fetch | undefined;
  let origXhrOpen: typeof XMLHttpRequest.prototype.open | undefined;
  let installedXhrOpen: typeof XMLHttpRequest.prototype.open | undefined;
  let origXhrSend: typeof XMLHttpRequest.prototype.send | undefined;
  let installedXhrSend: typeof XMLHttpRequest.prototype.send | undefined;
  let deactivate: (() => void) | undefined;
  let installed = false;

  const xhrMeta = new WeakMap<XMLHttpRequest, { url: string; method: string }>();

  const matchingRules = (url: string, method: string): NetworkRule[] | undefined => {
    let matched: NetworkRule[] | undefined;
    for (const rule of rules) {
      try {
        if (rule.match(url, method)) {
          matched ??= [];
          matched.push(rule);
        }
      } catch {
        // Ignore broken matcher so host network calls never fail.
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
    const { body, changed } = applyRequestTransforms(matched, url, method, initialBody);
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
      let text: string;
      try {
        text = await response.clone().text();
      } catch {
        return response;
      }
      let mutated = false;
      for (const rule of matched) {
        const info: NetworkResponseInfo = { url, method, body, status: response.status, text };
        notifyObserver(rule, info);
        if (rule.transformResponseText) {
          try {
            const next = rule.transformResponseText(info);
            if (next !== undefined && next !== text) {
              text = next;
              mutated = true;
            }
          } catch {
            // Keep previous text on transformer failure.
          }
        }
      }
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
          notifyObservers(matched, { url, method, body, status: response.status, text }),
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
        const { body: nextBody } = applyRequestTransforms(matched, meta.url, meta.method, body);
        const hasResponseTransformer = matched.some(
          (rule) => rule.transformResponseText !== undefined,
        );
        const hasObserver = matched.some((rule) => rule.onResponse !== undefined);
        const capturedBody = nextBody;

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
            let text = rawText;
            let mutated = false;
            for (const rule of matched) {
              const info: NetworkResponseInfo = {
                url: meta.url,
                method: meta.method,
                body: capturedBody,
                status: this.status,
                text,
              };
              notifyObserver(rule, info);
              if (rule.transformResponseText) {
                try {
                  const next = rule.transformResponseText(info);
                  if (next !== undefined && next !== text) {
                    text = next;
                    mutated = true;
                  }
                } catch {
                  // Keep previous text on transformer failure.
                }
              }
            }
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
              notifyObservers(matched, {
                url: meta.url,
                method: meta.method,
                body: capturedBody,
                status: this.status,
                text,
              });
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
  };
}
