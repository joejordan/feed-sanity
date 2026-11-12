import type { Feature } from '../core/feature';
import externalCss from './external-css';

/** Every feature the extension runs, in start order. Add new features here. */
export const features: readonly Feature[] = [externalCss];
