import type { FieldValue } from '../../facebook/post-fields';

const VARIABLE = /\$(\d+|\{[0-9A-Za-z_]+(?::[^{}]*)?\})/g;

/** True when `template` holds a variable that `expandVariables` would fill in. */
export const hasVariables = (template: string): boolean => template.search(VARIABLE) !== -1;

/**
 * Fills in the variables in a note or a tab name.
 *
 * - `$1`, `${1}`: what the first pair of brackets in the rule's regular
 *   expression caught
 * - `${any}`: the first pair of brackets that caught anything
 * - `${all}`: everything the brackets caught, joined
 * - `${author}` and other field names: that part of the post
 *
 * `${name:20}` keeps the first 20 characters. `${all:20:, }` joins with
 * `, `, and `${all:20::}` with a colon.
 */
export function expandVariables(
  template: unknown,
  matches: RegExpExecArray | null,
  field: (name: string) => FieldValue,
): string {
  if (typeof template !== 'string') {
    return '';
  }
  return template.replaceAll(VARIABLE, (_whole, reference: string) => {
    const [name = '', maxLength, joinerPart, colon] = reference.replace(/^\{|\}$/g, '').split(':');
    const joiner = joinerPart === '' && colon === '' ? ':' : joinerPart;
    const index = /^\d+$/.test(name) ? Number(name) : -1;

    let value: FieldValue | undefined;
    if (matches && matches[index] !== undefined) {
      value = matches[index];
    } else if (matches && name === 'any') {
      value = matches.slice(1).find(Boolean);
    } else if (matches && name === 'all') {
      value = matches.slice(1).join(joiner);
    } else {
      value = field(name);
    }
    const shown = Array.isArray(value) ? value.join(',') : (value ?? '');
    const length = Number(maxLength);
    return maxLength !== undefined && maxLength !== '' && Number.isInteger(length)
      ? shown.slice(0, length)
      : shown;
  });
}
