import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { startFeatures } from '../../core/app';
import { Options } from '../../core/options';
import { SavedData } from '../../core/saved';
import { Scope } from '../../core/scope';
import { bindPage } from '../../facebook/feature';
import { videoPage } from '../../facebook/testing';
import { extensionStore } from '../../platform/extension-store';
import storiesKeepPlaying from '.';

const byId = (id: string) => document.querySelector(`#${id}`) as HTMLElement;

/** Moves the pointer from `from`, or from outside the document, to `to`, as the browser reports it. */
function move(from: Element | null, to: Element): void {
  if (from) {
    from.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: to }));
  }
  to.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: from }));
}

/** Moves keyboard focus from `from` to `to`, as the browser reports it. */
function focus(from: Element | null, to: Element): void {
  from?.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: to }));
  to.dispatchEvent(new FocusEvent('focusin', { bubbles: true, relatedTarget: from }));
}

describe('stories_keep_playing', () => {
  let options: Options;
  /** Whether the stand-in for Facebook's viewer has paused the story. */
  let paused: boolean;
  /** The `mouseout` events that leave the list for the element around it. */
  let leaves: number;
  /** Ends the test's own listeners. */
  let listeners: Scope;

  /** Listens on `document`, as React does, for as long as the test runs. */
  function onDocument<K extends keyof DocumentEventMap>(
    type: K,
    listener: (event: DocumentEventMap[K]) => void,
  ): void {
    document.addEventListener(type, listener);
    listeners.add(() => document.removeEventListener(type, listener));
  }

  /**
   * Pauses the story while the pointer or focus is inside the wrapper,
   * working it out the way React works out Facebook's handlers.
   */
  function fakeViewer(): void {
    const inside = (node: EventTarget | null): boolean =>
      node instanceof Node && byId('pause-wrapper').contains(node);
    onDocument('mouseout', ({ target, relatedTarget }) => {
      if (inside(target) && !inside(relatedTarget)) {
        paused = false;
      } else if (!inside(target) && inside(relatedTarget)) {
        paused = true;
      }
    });
    // React takes this as the pointer coming from outside the document, or
    // from an element it no longer knows.
    onDocument('mouseover', ({ target, relatedTarget }) => {
      const known = relatedTarget instanceof Node && relatedTarget.isConnected;
      if (!known && inside(target)) {
        paused = true;
      }
    });
    onDocument('focusin', ({ target }) => {
      if (inside(target)) {
        paused = true;
      }
    });
    onDocument('focusout', ({ target }) => {
      if (inside(target)) {
        paused = false;
      }
    });
  }

  beforeEach(async () => {
    fakeBrowser.reset();
    history.replaceState({}, '', '/stories/123456789/UzpfSVNDOjE/');
    document.body.innerHTML = `
      <div role="banner">
        <div role="navigation" aria-label="Facebook"><a href="/" id="home">Home</a></div>
        <div role="navigation" aria-label="Account">
          <div role="button" tabindex="0" id="menu">Menu</div>
        </div>
      </div>
      <div id="pane">
        <div role="navigation" id="list">
          <h2 id="heading">All stories</h2>
          <div id="pause-wrapper">
            <div role="button" tabindex="0" id="s1">Story one</div>
            <div role="button" tabindex="0" id="s2">Story two</div>
          </div>
        </div>
      </div>
      <div role="main"><div id="story"></div></div>`;
    paused = false;
    leaves = 0;
    listeners = new Scope();
    fakeViewer();
    onDocument('mouseout', ({ relatedTarget }) => {
      if (relatedTarget === byId('pane')) {
        leaves++;
      }
    });

    options = new Options(extensionStore, 'u/options');
    const data = new SavedData(extensionStore, 'u');
    expect(await startFeatures([storiesKeepPlaying], options, bindPage(videoPage()), data)).toEqual(
      [],
    );
  });

  afterEach(async () => {
    await options.set('stories_keep_playing', false);
    listeners.dispose();
  });

  it('keeps the story playing when the pointer moves onto the list', () => {
    move(byId('story'), byId('s1'));

    expect(paused).toBe(false);
    // One of its own, which it does not answer.
    expect(leaves).toBe(1);
  });

  it('keeps the story playing when the pointer comes onto the list from outside the window', () => {
    move(null, byId('s1'));

    expect(paused).toBe(false);
    expect(leaves).toBe(1);
  });

  it('does nothing for moves out to an element around the last one, and the story plays on when the pointer leaves', () => {
    move(byId('story'), byId('s1'));
    move(byId('s1'), byId('s2'));
    expect(leaves).toBe(2);
    move(byId('s2'), byId('list'));

    expect(paused).toBe(false);
    expect(leaves).toBe(2);

    move(byId('list'), byId('story'));
    expect(paused).toBe(false);
    expect(leaves).toBe(2);
  });

  it('keeps the story playing when the pointer comes onto an entry from the heading of the list', () => {
    move(byId('story'), byId('heading'));
    move(byId('heading'), byId('s1'));

    expect(paused).toBe(false);
  });

  it('keeps the story playing when keyboard focus moves into the list and along it', () => {
    focus(byId('menu'), byId('s1'));
    expect(paused).toBe(false);

    focus(byId('s1'), byId('s2'));
    expect(paused).toBe(false);
    expect(leaves).toBe(2);
  });

  it('keeps the story playing when Facebook draws the list again under the pointer', () => {
    move(byId('story'), byId('s1'));
    const old = byId('s1');
    const fresh = old.cloneNode(true) as HTMLElement;
    old.replaceWith(fresh);

    // The browser reports the element now under the pointer, coming from the one that went.
    fresh.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: old }));

    expect(paused).toBe(false);
    expect(leaves).toBe(2);
  });

  it('answers an event the page stopped on its way, a moment later', async () => {
    onDocument('focusin', (event) => event.stopPropagation());

    focus(null, byId('s1'));
    expect(paused).toBe(true);

    await vi.waitFor(() => expect(paused).toBe(false));
  });

  it('leaves the labelled navigation in the top bar alone', () => {
    move(byId('story'), byId('menu'));
    focus(null, byId('home'));

    expect(leaves).toBe(0);
  });

  it('does nothing once switched off', async () => {
    await options.set('stories_keep_playing', false);

    move(byId('story'), byId('s1'));

    expect(paused).toBe(true);
    expect(leaves).toBe(0);
  });

  it('does nothing on other pages, and starts again on a stories page', () => {
    history.pushState({}, '', '/');
    dispatchEvent(new PopStateEvent('popstate'));

    move(byId('story'), byId('s1'));
    focus(null, byId('s2'));
    expect(paused).toBe(true);
    expect(leaves).toBe(0);

    focus(byId('s2'), byId('story'));
    move(byId('s1'), byId('story'));
    history.pushState({}, '', '/stories/');
    dispatchEvent(new PopStateEvent('popstate'));

    move(byId('story'), byId('s1'));
    expect(paused).toBe(false);
    expect(leaves).toBe(1);
  });
});
