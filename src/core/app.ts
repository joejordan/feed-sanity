import type { Feature } from './feature';
import type { Options } from './options';
import { createLogger } from './log';

/**
 * Registers every feature's options, reads the saved values, then starts the
 * features in list order, handing each one `page`. A feature that throws is
 * reported and skipped, so one feature broken by a Facebook change does not
 * take the others down. Returns the ids of the features that failed to start.
 */
export async function startFeatures<P>(
  features: readonly Feature<P>[],
  options: Options,
  page: P,
): Promise<string[]> {
  for (const feature of features) {
    if (feature.options) {
      options.register(feature.options);
    }
  }
  await options.load();

  const failed: string[] = [];
  await Promise.all(
    features.map(async (feature) => {
      const log = createLogger(feature.id);
      try {
        await feature.setup({ options, log, page });
      } catch (error) {
        failed.push(feature.id);
        log.error('failed to start', error);
      }
    }),
  );
  return failed;
}
