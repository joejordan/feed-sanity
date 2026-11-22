import { cleanup, render } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComposerState } from './feed-composer';
import { createLogger } from '../../core/log';
import { watchedValue } from '../../ui/watched';
import { FeedComposer } from './feed-composer';

const log = createLogger('test');

afterEach(cleanup);

describe('FeedComposer', () => {
  it('renders the personalized prompt, avatar and action buttons, and calls onOpen with the right mode', async () => {
    const state = watchedValue<ComposerState>(
      {
        shortName: 'Alex',
        userId: '1000123456',
        avatarSrc: 'https://scontent.fbcdn.net/avatar.jpg',
      },
      log,
    );
    const onOpen = vi.fn();
    const { getByRole, container } = render(<FeedComposer state={state} onOpen={onOpen} />);

    const prompt = getByRole('button', { name: "What's on your mind, Alex?" });
    expect(prompt).toBeDefined();
    expect(getByRole('link', { name: 'Your profile' }).getAttribute('href')).toBe(
      '/profile.php?id=1000123456',
    );
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'https://scontent.fbcdn.net/avatar.jpg',
    );
    expect(getByRole('link', { name: 'Live video' }).getAttribute('href')).toBe(
      '/live/producer/?entry_point=feedx_sprouts',
    );

    await userEvent.click(prompt);
    expect(onOpen).toHaveBeenLastCalledWith('post');

    await userEvent.click(getByRole('button', { name: 'Photo/video' }));
    expect(onOpen).toHaveBeenLastCalledWith('media');

    await userEvent.click(getByRole('button', { name: 'Feeling/activity' }));
    expect(onOpen).toHaveBeenLastCalledWith('feeling');
  });

  it('falls back cleanly when user info or avatar is missing and updates when it arrives', async () => {
    const state = watchedValue<ComposerState>(
      { shortName: null, userId: null, avatarSrc: null },
      log,
    );
    const { getByRole, queryByRole } = render(<FeedComposer state={state} onOpen={vi.fn()} />);

    expect(getByRole('button', { name: "What's on your mind?" })).toBeDefined();
    expect(getByRole('link', { name: 'Your profile' }).getAttribute('href')).toBe('/me/');

    state.set({ shortName: 'Sam', userId: '999', avatarSrc: null });
    await vi.waitFor(() => {
      expect(queryByRole('button', { name: "What's on your mind, Sam?" })).not.toBeNull();
    });
  });
});
