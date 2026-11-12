import { expect, it } from 'vitest';
import { currentUserId } from './user';

it('reads the user ID from the c_user cookie', () => {
  expect(currentUserId('datr=abc; c_user=100012345; xs=1')).toBe('100012345');
  expect(currentUserId('c_user=7')).toBe('7');
});

it("is 'anonymous' when there is no c_user cookie", () => {
  expect(currentUserId('datr=abc; not_c_user=5')).toBe('anonymous');
  expect(currentUserId('')).toBe('anonymous');
});
