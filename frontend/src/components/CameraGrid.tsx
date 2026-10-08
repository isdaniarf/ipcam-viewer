import { useElementSize } from "../hooks/useElementSize";
import { usePointerReorder } from "../hooks/usePointerReorder";
import { gridGeometry, layoutPlan, placeTiles, spanSize, type LayoutId } from "../lib/layouts";
import type { Camera, Protocol } from "../types/camera";
import { CameraCard, type DragRole } from "./CameraCard";

interface CameraGridProps {
  cameras: Camera[];
  protocol: Protocol;
  layout: LayoutId;
  fit: boolean;
  onFullscreen: (camera: Camera) => void;
  onSwap: (name: string, otherName: string) => void;
  onMove: (name: string, delta: number) => void;
}

const NARROW_WIDTH_PX = 640;
const MAIN_STREAM_MIN_WIDTH_PX = 720;

export function CameraGrid({
  cameras,
  protocol,
  layout,
  fit,
  onFullscreen,
  onSwap,
  onMove,
}: CameraGridProps) {
  const [containerRef, size] = useElementSize<HTMLElement>();
  const { drag, startDrag } = usePointerReorder(onSwap);

  const narrow = size.width < NARROW_WIDTH_PX;
  const gap = narrow ? 8 : 16;
  const placement = placeTiles(layoutPlan(layout, cameras.length, narrow));
  const geometry = gridGeometry(placement, size, gap, fit && !narrow);

  const slotOf = new Map(cameras.map((camera, index) => [camera.name, index]));
  const stableOrder = [...cameras].sort((a, b) => a.name.localeCompare(b.name));
  const dragged = drag ? cameras.find((camera) => camera.name === drag.key) : undefined;

  const dragRoleOf = (name: string): DragRole => {
    if (!drag) return null;
    if (drag.key === name) return "source";
    return drag.overKey === name ? "target" : null;
  };

  return (
    <main
      ref={containerRef}
      data-drag-container
      className={`min-h-0 flex-1 overflow-y-auto px-6 pb-6 ${drag ? "cursor-grabbing" : ""}`}
    >
      {size.width > 0 && cameras.length > 0 && (
        <div
          className="mx-auto grid select-none"
          style={{
            width: geometry.width,
            gap,
            gridTemplateColumns: `repeat(${placement.columns}, ${geometry.cellWidth}px)`,
            gridTemplateRows: `repeat(${placement.rows}, ${geometry.cellHeight}px)`,
          }}
        >
          {stableOrder.map((camera) => {
            const tile = placement.tiles[slotOf.get(camera.name)!];
            const tileWidth = spanSize(tile.width, geometry.cellWidth, gap);
            return (
              <CameraCard
                key={camera.name}
                camera={camera}
                protocol={protocol}
                mainStream={tileWidth >= MAIN_STREAM_MIN_WIDTH_PX}
                style={{
                  gridColumn: `${tile.column + 1} / span ${tile.width}`,
                  gridRow: `${tile.row + 1} / span ${tile.height}`,
                }}
                dragRole={dragRoleOf(camera.name)}
                onFullscreen={onFullscreen}
                onDragStart={(event) => startDrag(camera.name, event)}
                onMove={(delta) => onMove(camera.name, delta)}
              />
            );
          })}
        </div>
      )}

      {drag && dragged && (
        <div
          className="pointer-events-none fixed z-40 rounded-md bg-sky-500 px-2 py-1 text-sm font-medium text-white shadow-lg"
          style={{ left: drag.x + 14, top: drag.y + 14 }}
        >
          {dragged.label}
        </div>
      )}
    </main>
  );
}
