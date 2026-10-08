export type LayoutId =
  | "grid"
  | "spotlight"
  | "center"
  | "duo"
  | "stack"
  | "trio"
  | "quad"
  | "theater";

export interface Slot {
  width: number;
  height: number;
  column?: number;
  row?: number;
}

export interface LayoutPlan {
  columns: number;
  slots: Slot[];
}

export interface PlacedTile {
  column: number;
  row: number;
  width: number;
  height: number;
}

export interface Placement {
  columns: number;
  rows: number;
  tiles: PlacedTile[];
}

export interface LayoutPreset {
  id: LayoutId;
  label: string;
  description: string;
  sample: number;
  plan: (count: number) => LayoutPlan;
}

export interface GridGeometry {
  cellWidth: number;
  cellHeight: number;
  width: number;
}

const SMALL: Slot = { width: 1, height: 1 };
const ASPECT = 9 / 16;

function square(size: number): Slot {
  return { width: size, height: size };
}

function uniform(count: number, columns: number): LayoutPlan {
  return { columns: Math.max(1, columns), slots: Array.from({ length: count }, () => SMALL) };
}

function equalGrid(count: number): LayoutPlan {
  return uniform(count, Math.ceil(Math.sqrt(count)));
}

function withLarge(count: number, columns: number, large: Slot[]): LayoutPlan {
  return {
    columns,
    slots: Array.from({ length: count }, (_, index) => large[index] ?? SMALL),
  };
}

export const LAYOUTS: LayoutPreset[] = [
  {
    id: "grid",
    label: "Grid",
    description: "All cameras have the same size.",
    sample: 9,
    plan: equalGrid,
  },
  {
    id: "spotlight",
    label: "Spotlight",
    description: "One large camera. The small cameras go along the side and the bottom.",
    sample: 8,
    plan: (count) => {
      if (count <= 1) return uniform(count, 1);
      const size = Math.min(Math.max(Math.ceil((count - 2) / 2), 2), 5);
      return withLarge(count, size + 1, [square(size)]);
    },
  },
  {
    id: "center",
    label: "Center stage",
    description: "One large camera in the middle. The small cameras go around it.",
    sample: 13,
    plan: (count) => {
      if (count <= 2) return uniform(count, count);
      const row = count <= 9 ? 0 : 1;
      return withLarge(count, 4, [{ width: 2, height: 2, column: 1, row }]);
    },
  },
  {
    id: "duo",
    label: "Two large",
    description: "Two large cameras side by side. The small cameras go below.",
    sample: 6,
    plan: (count) => {
      if (count <= 2) return uniform(count, count);
      return withLarge(count, 4, [square(2), square(2)]);
    },
  },
  {
    id: "stack",
    label: "Stack",
    description: "Two large cameras, one above the other. The small cameras go along the side.",
    sample: 6,
    plan: (count) => {
      if (count <= 2) return uniform(count, 1);
      return withLarge(count, 3, [square(2), square(2)]);
    },
  },
  {
    id: "trio",
    label: "Three large",
    description: "Three large cameras in a row. The small cameras go below.",
    sample: 9,
    plan: (count) => {
      if (count <= 3) return uniform(count, count);
      return withLarge(count, 6, [square(2), square(2), square(2)]);
    },
  },
  {
    id: "quad",
    label: "Four large",
    description: "Four large cameras in a square. The small cameras go below.",
    sample: 8,
    plan: (count) => {
      if (count <= 4) return equalGrid(count);
      return withLarge(count, 4, [square(2), square(2), square(2), square(2)]);
    },
  },
  {
    id: "theater",
    label: "Theater",
    description: "One camera across the full width. The small cameras go in a strip below.",
    sample: 5,
    plan: (count) => {
      if (count <= 1) return uniform(count, 1);
      const columns = Math.min(Math.max(count - 1, 3), 6);
      return withLarge(count, columns, [square(columns)]);
    },
  },
];

export const LAYOUT_IDS: LayoutId[] = LAYOUTS.map((preset) => preset.id);

export function layoutPreset(id: LayoutId): LayoutPreset {
  return LAYOUTS.find((preset) => preset.id === id) ?? LAYOUTS[0];
}

function narrowPlan(plan: LayoutPlan): LayoutPlan {
  if (plan.slots.length <= 1) return uniform(plan.slots.length, 1);
  return {
    columns: 2,
    slots: plan.slots.map((slot) => (slot.width > 1 ? square(2) : SMALL)),
  };
}

export function layoutPlan(id: LayoutId, count: number, narrow: boolean): LayoutPlan {
  const plan = layoutPreset(id).plan(count);
  return narrow ? narrowPlan(plan) : plan;
}

export function placeTiles(plan: LayoutPlan): Placement {
  const { columns } = plan;
  const taken = new Set<string>();

  const isFree = (tile: PlacedTile) => {
    if (tile.column < 0 || tile.column + tile.width > columns) return false;
    for (let row = tile.row; row < tile.row + tile.height; row += 1) {
      for (let column = tile.column; column < tile.column + tile.width; column += 1) {
        if (taken.has(`${row}:${column}`)) return false;
      }
    }
    return true;
  };

  const take = (tile: PlacedTile) => {
    for (let row = tile.row; row < tile.row + tile.height; row += 1) {
      for (let column = tile.column; column < tile.column + tile.width; column += 1) {
        taken.add(`${row}:${column}`);
      }
    }
    return tile;
  };

  const firstFree = (width: number, height: number): PlacedTile => {
    for (let row = 0; ; row += 1) {
      for (let column = 0; column + width <= columns; column += 1) {
        const tile = { column, row, width, height };
        if (isFree(tile)) return tile;
      }
    }
  };

  const tiles: (PlacedTile | undefined)[] = plan.slots.map((slot) => {
    if (slot.column === undefined || slot.row === undefined) return undefined;
    const tile = { column: slot.column, row: slot.row, width: Math.min(slot.width, columns), height: slot.height };
    return isFree(tile) ? take(tile) : undefined;
  });

  const placed = plan.slots.map(
    (slot, index) => tiles[index] ?? take(firstFree(Math.min(slot.width, columns), slot.height)),
  );

  const rows = placed.reduce((most, tile) => Math.max(most, tile.row + tile.height), 0);
  return { columns, rows, tiles: placed };
}

export function gridGeometry(
  placement: Placement,
  available: { width: number; height: number },
  gap: number,
  fit: boolean,
): GridGeometry {
  const { columns, rows } = placement;
  let cellWidth = (available.width - (columns - 1) * gap) / columns;
  let cellHeight = cellWidth * ASPECT;

  if (fit && rows > 0 && available.height > 0) {
    const tallestCell = (available.height - (rows - 1) * gap) / rows;
    if (tallestCell < cellHeight) {
      cellHeight = Math.max(tallestCell, 0);
      cellWidth = cellHeight / ASPECT;
    }
  }

  cellWidth = Math.floor(cellWidth);
  cellHeight = Math.floor(cellHeight);
  return { cellWidth, cellHeight, width: columns * cellWidth + (columns - 1) * gap };
}

export function spanSize(cells: number, cellSize: number, gap: number): number {
  return cells * cellSize + (cells - 1) * gap;
}
