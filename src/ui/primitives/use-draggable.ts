import { useCallback, useEffect, useRef, useState } from 'react';

const DRAG_THRESHOLD_PX = 3;
const MIN_VISIBLE_X = 80;
const MIN_VISIBLE_Y = 48;
const INTERACTIVE_SELECTOR =
  'button, input, select, textarea, a, label, [role="button"], .fs-switch';

export interface DragOffset {
  readonly x: number;
  readonly y: number;
}

export interface DragPointerEvent {
  readonly pointerType: string;
  readonly button: number;
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly target: EventTarget | null;
}

export interface DragDoubleClickEvent {
  readonly target: EventTarget | null;
}

export interface DragHandleProps {
  readonly onPointerDown: (event: DragPointerEvent) => void;
  readonly onDoubleClick: (event: DragDoubleClickEvent) => void;
}

export interface DraggableResult {
  readonly offset: DragOffset;
  readonly dragging: boolean;
  readonly moved: boolean;
  readonly style: { readonly transform: string } | undefined;
  readonly handleProps: DragHandleProps;
  readonly resetPosition: () => void;
}

function clampOffset(
  baseRect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  dx: number,
  dy: number,
): DragOffset {
  const vw = globalThis.innerWidth || 1280;
  const vh = globalThis.innerHeight || 720;
  const minLeft = MIN_VISIBLE_X - baseRect.width;
  const maxLeft = vw - MIN_VISIBLE_X;
  const minTop = 8;
  const maxTop = Math.max(minTop, vh - MIN_VISIBLE_Y);
  const clampedLeft = Math.min(maxLeft, Math.max(minLeft, baseRect.left + dx));
  const clampedTop = Math.min(maxTop, Math.max(minTop, baseRect.top + dy));
  return {
    x: Math.round(clampedLeft - baseRect.left),
    y: Math.round(clampedTop - baseRect.top),
  };
}

/**
 * Makes an in-page floating panel or `<dialog>` draggable by its header bar,
 * clamping to the viewport, ignoring clicks on interactive controls inside the
 * handle, supporting double-click to recenter, and exposing `dragging` so the
 * surface can turn translucent while moving.
 */
export function useDraggable(targetRef: { readonly current: HTMLElement | null }): DraggableResult {
  const [offset, setOffset] = useState<DragOffset>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const offsetRef = useRef(offset);
  offsetRef.current = offset;
  const cleanupRef = useRef<(() => void) | undefined>(undefined);

  const resetPosition = useCallback(() => {
    setOffset({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    const onResize = (): void => {
      const current = offsetRef.current;
      if (current.x === 0 && current.y === 0) {
        return;
      }
      const el = targetRef.current;
      if (!el) {
        return;
      }
      const rect = el.getBoundingClientRect();
      const baseRect = {
        left: rect.left - current.x,
        top: rect.top - current.y,
        width: rect.width,
        height: rect.height,
      };
      setOffset(clampOffset(baseRect, current.x, current.y));
    };
    globalThis.addEventListener('resize', onResize);
    return () => {
      globalThis.removeEventListener('resize', onResize);
      cleanupRef.current?.();
      cleanupRef.current = undefined;
    };
  }, [targetRef]);

  const onPointerDown = useCallback(
    (event: DragPointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.closest(INTERACTIVE_SELECTOR)) {
        return;
      }
      const el = targetRef.current;
      if (!el) {
        return;
      }
      cleanupRef.current?.();

      const startX = event.clientX;
      const startY = event.clientY;
      const startOffset = offsetRef.current;
      const rect = el.getBoundingClientRect();
      const baseRect = {
        left: rect.left - startOffset.x,
        top: rect.top - startOffset.y,
        width: rect.width,
        height: rect.height,
      };
      const pointerId = event.pointerId;
      let started = false;

      const onMove = (moveEvent: PointerEvent): void => {
        if (moveEvent.pointerId !== pointerId) {
          return;
        }
        const deltaX = moveEvent.clientX - startX;
        const deltaY = moveEvent.clientY - startY;
        if (!started) {
          if (Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD_PX) {
            return;
          }
          started = true;
          setDragging(true);
        }
        setOffset(clampOffset(baseRect, startOffset.x + deltaX, startOffset.y + deltaY));
      };

      const finish = (endEvent: PointerEvent): void => {
        if (endEvent.pointerId !== pointerId) {
          return;
        }
        cleanup();
      };

      const cleanup = (): void => {
        globalThis.removeEventListener('pointermove', onMove);
        globalThis.removeEventListener('pointerup', finish);
        globalThis.removeEventListener('pointercancel', finish);
        if (cleanupRef.current === cleanup) {
          cleanupRef.current = undefined;
        }
        if (started) {
          setDragging(false);
        }
      };

      cleanupRef.current = cleanup;
      globalThis.addEventListener('pointermove', onMove);
      globalThis.addEventListener('pointerup', finish);
      globalThis.addEventListener('pointercancel', finish);
    },
    [targetRef],
  );

  const onDoubleClick = useCallback(
    (event: DragDoubleClickEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(INTERACTIVE_SELECTOR)) {
        return;
      }
      resetPosition();
    },
    [resetPosition],
  );

  const moved = offset.x !== 0 || offset.y !== 0;
  const style = moved ? { transform: `translate3d(${offset.x}px, ${offset.y}px, 0)` } : undefined;

  return {
    offset,
    dragging,
    moved,
    style,
    handleProps: { onPointerDown, onDoubleClick },
    resetPosition,
  };
}
