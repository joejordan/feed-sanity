/** Immutable list edits used by the filter list and editor. */

export const replaced = <T>(list: readonly T[], index: number, item: T): T[] =>
  list.map((existing, at) => (at === index ? item : existing));

export const without = <T>(list: readonly T[], index: number): T[] =>
  list.filter((_item, at) => at !== index);

export function inserted<T>(list: readonly T[], index: number, item: T): T[] {
  const result = [...list];
  result.splice(index, 0, item);
  return result;
}

export function moved<T>(list: readonly T[], from: number, to: number): T[] {
  const result = [...list];
  result.splice(to, 0, ...result.splice(from, 1));
  return result;
}
