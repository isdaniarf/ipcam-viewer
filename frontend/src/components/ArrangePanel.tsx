import { useEffect, useRef, type KeyboardEvent } from "react";
import { usePointerReorder } from "../hooks/usePointerReorder";
import type { Camera } from "../types/camera";
import { GripIcon } from "./GripIcon";

interface ArrangePanelProps {
  cameras: Camera[];
  hidden: Set<string>;
  pageSize: number | null;
  onClose: () => void;
  onReorder: (name: string, target: string, after: boolean) => void;
  onShift: (name: string, delta: number) => void;
  onToggleHidden: (name: string) => void;
  onReset: () => void;
}

const MOVE_KEYS: Record<string, number> = { ArrowUp: -1, ArrowDown: 1 };

function handleId(name: string): string {
  return `arrange-move-${name}`;
}

export function ArrangePanel({
  cameras,
  hidden,
  pageSize,
  onClose,
  onReorder,
  onShift,
  onToggleHidden,
  onReset,
}: ArrangePanelProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const { drag, startDrag } = usePointerReorder(onReorder);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => opener?.focus?.();
  }, []);

  useEffect(() => {
    const handleKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const handleMoveKey = (name: string, event: KeyboardEvent<HTMLButtonElement>) => {
    const delta = MOVE_KEYS[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    onShift(name, delta);
    requestAnimationFrame(() => document.getElementById(handleId(name))?.focus());
  };

  const shownNames = cameras.filter((camera) => !hidden.has(camera.name)).map((camera) => camera.name);
  const pageOf = (name: string) =>
    pageSize === null ? null : Math.floor(shownNames.indexOf(name) / pageSize) + 1;

  return (
    <div
      id="arrange-panel"
      role="dialog"
      aria-label="Arrange the cameras"
      className="fixed inset-y-0 right-0 z-40 flex w-80 max-w-[calc(100%-2rem)] flex-col border-l border-gray-800 bg-gray-900 shadow-2xl"
    >
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="text-base font-semibold text-white">Arrange the cameras</h2>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close the arrange panel"
          className="rounded p-1 text-gray-400 hover:text-white focus-visible:outline-2 focus-visible:outline-sky-400"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </button>
      </div>

      <p className="px-4 pb-3 text-sm text-gray-400">
        Drag a camera to change the order. Clear the box to hide a camera.
      </p>

      <ul data-drag-container className="min-h-0 flex-1 select-none overflow-y-auto px-2">
        {cameras.map((camera) => {
          const isHidden = hidden.has(camera.name);
          const page = isHidden ? null : pageOf(camera.name);

          const isSource = drag?.key === camera.name;
          const isTarget = drag !== null && !isSource && drag.overKey === camera.name;
          const marker = isTarget
            ? drag.after
              ? "shadow-[inset_0_-2px_0_0_var(--color-sky-400)]"
              : "shadow-[inset_0_2px_0_0_var(--color-sky-400)]"
            : "";

          return (
            <li
              key={camera.name}
              data-drag-key={camera.name}
              className={`flex items-center gap-2 rounded-md px-2 py-2 hover:bg-gray-800/60 ${marker} ${
                isSource ? "opacity-40" : ""
              }`}
            >
              <button
                id={handleId(camera.name)}
                type="button"
                onPointerDown={(event) => startDrag(camera.name, event)}
                onKeyDown={(event) => handleMoveKey(camera.name, event)}
                aria-label={`Move ${camera.label}. Use the up and down arrow keys.`}
                className="cursor-grab touch-none rounded p-1 text-gray-500 hover:text-gray-200 focus-visible:outline-2 focus-visible:outline-sky-400"
              >
                <GripIcon className="h-4 w-4" />
              </button>
              <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!isHidden}
                  onChange={() => onToggleHidden(camera.name)}
                  className="h-4 w-4 accent-sky-500"
                />
                <span className={`truncate ${isHidden ? "text-gray-500" : "text-gray-100"}`}>
                  {camera.label}
                </span>
              </label>
              <span className="shrink-0 text-xs text-gray-500">
                {isHidden ? "Hidden" : page !== null ? `Page ${page}` : ""}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="border-t border-gray-800 px-4 py-3">
        <button
          type="button"
          onClick={onReset}
          className="rounded-md bg-gray-800 px-3 py-1 text-sm font-medium text-gray-100 hover:bg-gray-700"
        >
          Reset the order and show all cameras
        </button>
      </div>
    </div>
  );
}
