import { placeTiles, spanSize, type LayoutPreset } from "../lib/layouts";

const CELL_WIDTH = 16;
const CELL_HEIGHT = 9;
const GAP = 2;

export function LayoutIcon({ preset, className }: { preset: LayoutPreset; className?: string }) {
  const { columns, rows, tiles } = placeTiles(preset.plan(preset.sample));
  const width = spanSize(columns, CELL_WIDTH, GAP);
  const height = spanSize(rows, CELL_HEIGHT, GAP);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${width} ${height}`}
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      {tiles.map((tile, index) => (
        <rect
          key={index}
          x={tile.column * (CELL_WIDTH + GAP)}
          y={tile.row * (CELL_HEIGHT + GAP)}
          width={spanSize(tile.width, CELL_WIDTH, GAP)}
          height={spanSize(tile.height, CELL_HEIGHT, GAP)}
          rx={1.5}
          opacity={tile.width > 1 ? 1 : 0.55}
        />
      ))}
    </svg>
  );
}
