import type { PageBridge } from '../core/bridge';
import { isRecord } from '../core/storage';
import { OPEN_POST_COMPOSER } from './page-actions';
import { COMPOSER_INFO } from './react-readers';

/** What the inline post composer knows about the signed-in user. */
export interface ComposerInfo {
  readonly shortName: string | null;
  readonly userId: string | null;
}

/** Which part of Facebook's native composer dialog to open. */
export type ComposerMode = 'post' | 'media' | 'feeling';

const optionalText = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

/** Checks what the `composer-info` page-world reader sent back. */
export function checkComposerInfo(answer: unknown): ComposerInfo | null {
  if (!isRecord(answer)) {
    return null;
  }
  const shortName = optionalText(answer.shortName);
  const userId = optionalText(answer.userId);
  return shortName || userId ? { shortName, userId } : null;
}

/** Asks the page-world side for the signed-in user's short name and ID. */
export async function composerInfo(
  bridge: Pick<PageBridge, 'ask'>,
  element: Element,
  signal?: AbortSignal,
): Promise<ComposerInfo | null> {
  return checkComposerInfo(await bridge.ask(element, COMPOSER_INFO, signal));
}

/** Checks what the `open-post-composer` page-world action sent back. */
export function checkOpenComposer(answer: unknown): boolean {
  return isRecord(answer) && answer.opened === true;
}

/** Opens Facebook's native "Create post" composer dialog through the page-world bridge. */
export async function openPostComposer(
  bridge: Pick<PageBridge, 'run'>,
  mode: ComposerMode = 'post',
  signal?: AbortSignal,
): Promise<boolean> {
  return checkOpenComposer(await bridge.run(OPEN_POST_COMPOSER, { mode }, signal));
}
