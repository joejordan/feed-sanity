// Stable numeric Preact keys for ordered lists whose saved items carry no id
// of their own (a filter's conditions, actions and values).

import { useRef } from 'react';

export interface StableKeyList {
  readonly keys: readonly number[];
  readonly push: () => void;
  readonly removeAt: (index: number) => void;
}

export function useStableKeys(length: number): StableKeyList {
  const nextId = useRef(1);
  const keysRef = useRef<number[]>([]);

  while (keysRef.current.length < length) {
    keysRef.current.push(nextId.current++);
  }
  if (keysRef.current.length > length) {
    keysRef.current.length = length;
  }

  return {
    keys: keysRef.current,
    push() {
      keysRef.current.push(nextId.current++);
    },
    removeAt(index) {
      keysRef.current.splice(index, 1);
    },
  };
}
