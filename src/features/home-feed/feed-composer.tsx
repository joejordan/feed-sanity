import { useSyncExternalStore } from 'react';
import type { ComposerMode } from '../../facebook/post-composer';
import type { Watched } from '../../ui/watched';

export interface ComposerState {
  readonly shortName: string | null;
  readonly userId: string | null;
  readonly avatarSrc: string | null;
}

export interface FeedComposerProps {
  state: Watched<ComposerState>;
  onOpen: (mode: ComposerMode) => void;
}

/** Facebook's Live Producer address, matching the Live video sprout on Home. */
const LIVE_PRODUCER_URL = '/live/producer/?entry_point=feedx_sprouts';

function PersonIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="8.5" r="4" />
      <path d="M4.5 20.5c0-3.8 3.4-6.5 7.5-6.5s7.5 2.7 7.5 6.5" />
    </svg>
  );
}

function LiveVideoIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2.5" y="6" width="13.5" height="12" rx="3" fill="#f3425f" />
      <path d="M16 10.2 21 7.2c.6-.4 1.5 0 1.5.8v8c0 .8-.9 1.2-1.5.8l-5-3v-3.6z" fill="#f3425f" />
      <circle cx="9.25" cy="12" r="2.25" fill="#fff" />
    </svg>
  );
}

function PhotoVideoIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="4.5" width="18" height="15" rx="3" fill="#45bd62" />
      <circle cx="8.5" cy="9.5" r="1.75" fill="#fff" />
      <path d="M5.5 17 10 12.2l3.2 3.2 2.3-2.3 3 3.9H5.5z" fill="#fff" />
    </svg>
  );
}

function FeelingIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9.5" fill="#f7b928" />
      <circle cx="8.75" cy="10" r="1.35" fill="#5c4200" />
      <circle cx="15.25" cy="10" r="1.35" fill="#5c4200" />
      <path
        d="M8 14c.9 1.7 2.3 2.5 4 2.5s3.1-.8 4-2.5"
        stroke="#5c4200"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * The "What's on your mind?" post composer box shown at the top of Facebook's
 * alternate Home feeds (`Friends`, `Favorites`, `Groups`, `Pages`,
 * `Most recent`), matching Facebook's own Home composer card and launching
 * Facebook's native "Create post" dialog.
 */
export function FeedComposer({ state, onOpen }: FeedComposerProps) {
  const { shortName, userId, avatarSrc } = useSyncExternalStore(state.subscribe, state.get);
  const prompt = shortName ? `What's on your mind, ${shortName}?` : "What's on your mind?";
  const profileHref = userId ? `/profile.php?id=${encodeURIComponent(userId)}` : '/me/';

  return (
    <div className="card" role="region" aria-label="Create a post">
      <div className="row">
        <a className="avatar" href={profileHref} aria-label="Your profile">
          {avatarSrc ? <img className="avatar-img" src={avatarSrc} alt="" /> : <PersonIcon />}
        </a>
        <button type="button" className="prompt" onClick={() => onOpen('post')}>
          <span className="prompt-text">{prompt}</span>
        </button>
        <div className="sprouts">
          <a className="sprout" href={LIVE_PRODUCER_URL} aria-label="Live video" title="Live video">
            <LiveVideoIcon />
          </a>
          <button
            type="button"
            className="sprout"
            aria-label="Photo/video"
            title="Photo/video"
            onClick={() => onOpen('media')}
          >
            <PhotoVideoIcon />
          </button>
          <button
            type="button"
            className="sprout"
            aria-label="Feeling/activity"
            title="Feeling/activity"
            onClick={() => onOpen('feeling')}
          >
            <FeelingIcon />
          </button>
        </div>
      </div>
    </div>
  );
}
