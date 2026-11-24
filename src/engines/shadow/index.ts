// Reversible, zero-global MAIN-world `Element.prototype.attachShadow` hook.
// Allows sites built on custom Web Components or late-attaching Shadow Roots
// (Lit, Reddit Shreddit, YouTube Polymer, X Chat/Calls) to receive immediate
// notifications whenever a host attaches a ShadowRoot—without polling or
// leaving global markers on `window`.

export interface ShadowHookHost {
  Element?: {
    prototype: {
      attachShadow: Element['attachShadow'];
    };
  };
}

export interface AttachedShadowInfo {
  readonly host: Element;
  readonly root: ShadowRoot;
  readonly mode: ShadowRootMode;
}

/**
 * Wraps `Element.prototype.attachShadow` on `host` (defaults to `globalThis`)
 * to invoke `onAttach` for every Shadow Root created while active. Returns an
 * idempotent uninstall function that restores the original descriptor if no
 * other script wrapped it afterwards.
 */
export function installAttachShadowHook(
  onAttach: (info: AttachedShadowInfo) => void,
  host: ShadowHookHost = globalThis,
): () => void {
  const proto = host.Element?.prototype;
  if (!proto || typeof proto.attachShadow !== 'function') {
    return () => undefined;
  }
  const original = proto.attachShadow;
  let active = true;

  const wrapped: Element['attachShadow'] = function tappedAttachShadow(
    this: Element,
    init: ShadowRootInit,
  ): ShadowRoot {
    const root = original.call(this, init);
    if (active) {
      try {
        onAttach({ host: this, root, mode: init.mode });
      } catch {
        // Never break host Shadow DOM attachment if an observer throws.
      }
    }
    return root;
  };

  proto.attachShadow = wrapped;

  return () => {
    if (!active) {
      return;
    }
    active = false;
    if (proto.attachShadow === wrapped) {
      proto.attachShadow = original;
    }
  };
}

/** Cross-world DOM event dispatched on an element that just attached an open ShadowRoot. */
export const SHADOW_ATTACHED_EVENT = 'feed-sanity:shadow-attached';

/**
 * Installs `installAttachShadowHook` and coalesces synchronous open Shadow Root
 * attachments into one microtask callback (`onBatch(count)`). Also dispatches a
 * bubbling, composed `SHADOW_ATTACHED_EVENT` directly on each connected `host`
 * so isolated-world `DomEnvironment` receives the exact host in O(1) without
 * scanning the document. Returns an idempotent teardown function that restores
 * `Element.prototype.attachShadow` and cancels any pending microtask notification.
 */
export function watchOpenShadowAttachments(
  onBatch: (count: number) => void,
  host: ShadowHookHost = globalThis,
): () => void {
  let pendingCount = 0;
  let disposed = false;

  const remove = installAttachShadowHook(({ host: target, mode }) => {
    if (mode !== 'open' || disposed) {
      return;
    }
    if (target.isConnected && typeof target.dispatchEvent === 'function') {
      try {
        target.dispatchEvent(new Event(SHADOW_ATTACHED_EVENT, { bubbles: true, composed: true }));
      } catch {
        // Ignore exotic non-EventTarget hosts.
      }
    }
    pendingCount++;
    if (pendingCount === 1) {
      queueMicrotask(() => {
        const count = pendingCount;
        pendingCount = 0;
        if (!disposed && count > 0) {
          onBatch(count);
        }
      });
    }
  }, host);

  return () => {
    disposed = true;
    pendingCount = 0;
    remove();
  };
}
