/** Immutable list and field edits used by the filter list and editor. */

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

/**
 * `target` with the optional field `key` set to `value`, or without the field
 * when `value` is undefined, false or a blank string. Keeps saved filters small.
 */
export function withField<T extends object, K extends keyof T & string>(
  target: T,
  key: K,
  value: T[K] | undefined,
): T {
  const { [key]: _old, ...rest } = target;
  const empty =
    value === undefined || value === false || (typeof value === 'string' && !value.trim());
  return (empty ? rest : { ...rest, [key]: value }) as T;
}
