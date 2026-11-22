interface TrustedTypePolicy {
  createScriptURL: (input: string) => unknown;
}

interface TrustedTypePolicyFactory {
  createPolicy: (
    name: string,
    rules: { createScriptURL: (input: string) => string },
  ) => TrustedTypePolicy;
}

const policyByFactory = new WeakMap<TrustedTypePolicyFactory, TrustedTypePolicy | null>();
const allowedBlobUrls = new Set<string>();

function trustedScriptUrl(url: string): unknown {
  const factory = (globalThis as { trustedTypes?: TrustedTypePolicyFactory }).trustedTypes;
  if (!factory || typeof factory.createPolicy !== 'function') {
    return url;
  }
  let policy = policyByFactory.get(factory);
  if (policy === undefined) {
    try {
      policy = factory.createPolicy('feed-sanity', {
        createScriptURL: (input) => {
          if (!input.startsWith('blob:') || !allowedBlobUrls.has(input)) {
            throw new TypeError('Feed Sanity only allows its own blob: script URLs');
          }
          return input;
        },
      });
    } catch {
      policy = null;
    }
    policyByFactory.set(factory, policy);
  }
  return policy ? policy.createScriptURL(url) : url;
}

const REFUSED_ERROR = 'the page refused a script from a blob: address';

/**
 * Runs `code` in the page's own world, as a script loaded from a `blob:`
 * address. Uses a Trusted Types policy when the host page enforces Trusted
 * Types (such as Gmail or YouTube). Resolves once the script has run, and
 * rejects when the page refuses it. The script element and its address are
 * removed either way.
 */
export function runInPage(code: string): Promise<void> {
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  const script = document.createElement('script');
  allowedBlobUrls.add(url);
  try {
    (script as unknown as { src: unknown }).src = trustedScriptUrl(url);
  } catch {
    URL.revokeObjectURL(url);
    return Promise.reject(new Error(REFUSED_ERROR));
  } finally {
    allowedBlobUrls.delete(url);
  }
  return new Promise((resolve, reject) => {
    const end = (): void => {
      script.remove();
      URL.revokeObjectURL(url);
    };
    script.addEventListener('load', () => {
      end();
      resolve();
    });
    script.addEventListener('error', () => {
      end();
      reject(new Error(REFUSED_ERROR));
    });
    // A userscript can start before the page has a <head>.
    (document.head ?? document.documentElement).append(script);
  });
}
