import type { Feature } from '../core/feature';
import type { FacebookPage } from '../facebook/feature';
import externalCss from './external-css';
import hidePosts from './hide-posts';

/** Every feature the extension runs, in start order. Add new features here. */
export const features: readonly Feature<FacebookPage>[] = [externalCss, hidePosts];
