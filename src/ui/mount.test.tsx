import { act } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HOST_TAG, mount } from './mount';

describe('mount', () => {
  let unmount: (() => void) | undefined;

  function show(css?: string): ShadowRoot {
    act(() => {
      unmount = mount(<p>Hello</p>, css === undefined ? { id: 'test_ui' } : { id: 'test_ui', css });
    });
    const host = document.querySelector(`${HOST_TAG}#test_ui`);
    if (!host?.shadowRoot) {
      throw new Error('no host');
    }
    return host.shadowRoot;
  }

  afterEach(() => {
    act(() => unmount?.());
    unmount = undefined;
  });

  it('renders into a shadow root with the theme and the given styles', () => {
    const shadow = show('p { color: red; }');

    expect(shadow.querySelector('p')?.textContent).toBe('Hello');
    const css = shadow.querySelector('style')?.textContent ?? '';
    expect(css.endsWith('p { color: red; }')).toBe(true);
  });

  it('keeps typed keys from reaching the page', () => {
    const shadow = show();
    const onPage = vi.fn();
    document.addEventListener('keydown', onPage);

    shadow
      .querySelector('p')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true, composed: true }));

    expect(onPage).not.toHaveBeenCalled();
    document.removeEventListener('keydown', onPage);
  });

  it('removes the host when unmounted', () => {
    show();
    act(() => unmount?.());
    unmount = undefined;

    expect(document.querySelector(HOST_TAG)).toBeNull();
  });
});
