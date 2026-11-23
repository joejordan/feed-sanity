// Maintains stable numeric React/Preact keys for ordered lists whose persisted
// items (Filter, Rule, Action) must NOT carry synthetic ID properties.

import { useRef } from 'react';

export interface StableKeyList {
  readonly keys: readonly number[];
  readonly push: () => void;
  readonly insertAt: (index: number) => void;
  readonly removeAt: (index: number) => void;
  readonly move: (from: number, to: number) => void;
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
    insertAt(index) {
      keysRef.current.splice(index, 0, nextId.current++);
    },
    removeAt(index) {
      keysRef.current.splice(index, 1);
    },
    move(from, to) {
      const [movedKey] = keysRef.current.splice(from, 1);
      if (movedKey !== undefined) {
        keysRef.current.splice(to, 0, movedKey);
      }
    },
  };
}
