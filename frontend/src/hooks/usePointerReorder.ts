import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

export interface DragState {
  key: string;
  overKey: string | null;
  after: boolean;
  x: number;
  y: number;
}

type DropHandler = (key: string, overKey: string, after: boolean) => void;

const DRAG_THRESHOLD_PX = 6;

function dropTargetAt(container: HTMLElement, x: number, y: number) {
  const element = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drag-key]");
  if (!element || !container.contains(element)) return { overKey: null, after: false };
  const rect = element.getBoundingClientRect();
  return { overKey: element.dataset.dragKey ?? null, after: y > rect.top + rect.height / 2 };
}

export function usePointerReorder(onDrop: DropHandler) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const dropRef = useRef(onDrop);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    dropRef.current = onDrop;
  }, [onDrop]);

  useEffect(() => () => stopRef.current?.(), []);

  const startDrag = useCallback((key: string, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const found = event.currentTarget.closest<HTMLElement>("[data-drag-container]");
    if (!found) return;
    const container: HTMLElement = found;

    stopRef.current?.();
    const { pointerId, clientX: startX, clientY: startY } = event;
    let current: DragState | null = null;

    const removeListeners = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleCancel);
      window.removeEventListener("keydown", handleKey, true);
      stopRef.current = null;
    };

    const finish = (commit: boolean) => {
      removeListeners();
      const ended = current;
      current = null;
      setDrag(null);
      if (commit && ended?.overKey && ended.overKey !== key) {
        dropRef.current(key, ended.overKey, ended.after);
      }
    };

    function handleMove(moveEvent: PointerEvent) {
      if (moveEvent.pointerId !== pointerId) return;
      const { clientX: x, clientY: y } = moveEvent;
      if (!current && Math.hypot(x - startX, y - startY) < DRAG_THRESHOLD_PX) return;
      moveEvent.preventDefault();
      current = { key, x, y, ...dropTargetAt(container, x, y) };
      setDrag(current);
    }

    function handleUp(upEvent: PointerEvent) {
      if (upEvent.pointerId === pointerId) finish(true);
    }

    function handleCancel(cancelEvent: PointerEvent) {
      if (cancelEvent.pointerId === pointerId) finish(false);
    }

    function handleKey(keyEvent: KeyboardEvent) {
      if (keyEvent.key !== "Escape" || !current) return;
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      finish(false);
    }

    window.addEventListener("pointermove", handleMove, { passive: false });
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleCancel);
    window.addEventListener("keydown", handleKey, true);
    stopRef.current = removeListeners;
  }, []);

  return { drag, startDrag };
}
