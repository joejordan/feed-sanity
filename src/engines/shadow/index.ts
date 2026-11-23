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
