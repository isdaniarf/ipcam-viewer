import { PAGE_SIZES } from "../hooks/useLayoutSettings";
import { LAYOUTS, type LayoutId } from "../lib/layouts";
import { LayoutIcon } from "./LayoutIcon";

interface LayoutToolbarProps {
  layout: LayoutId;
  pageSize: number | null;
  fit: boolean;
  page: number;
  pageCount: number;
  arrangeOpen: boolean;
  onLayoutChange: (layout: LayoutId) => void;
  onPageSizeChange: (pageSize: number | null) => void;
  onFitChange: (fit: boolean) => void;
  onPageChange: (page: number) => void;
  onArrangeToggle: () => void;
}

const TOGGLE_BUTTON =
  "rounded-md px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-sky-400";

export function LayoutToolbar({
  layout,
  pageSize,
  fit,
  page,
  pageCount,
  arrangeOpen,
  onLayoutChange,
  onPageSizeChange,
  onFitChange,
  onPageChange,
  onArrangeToggle,
}: LayoutToolbarProps) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 px-6 pb-4">
      <div className="flex flex-wrap rounded-lg bg-gray-900 p-1" role="group" aria-label="Layout">
        {LAYOUTS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => onLayoutChange(preset.id)}
            aria-pressed={preset.id === layout}
            aria-label={preset.label}
            title={`${preset.label}. ${preset.description}`}
            className={`rounded-md p-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-sky-400 ${
              preset.id === layout ? "bg-gray-700 text-white" : "text-gray-500 hover:text-gray-200"
            }`}
          >
            <LayoutIcon preset={preset} className="h-6 w-9" />
          </button>
        ))}
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-400">
        Per page
        <select
          value={pageSize ?? "all"}
          onChange={(event) =>
            onPageSizeChange(event.target.value === "all" ? null : Number(event.target.value))
          }
          className="rounded-md border border-gray-800 bg-gray-900 px-2 py-1 text-sm text-gray-100"
        >
          <option value="all">All</option>
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>

      <div className="flex rounded-lg bg-gray-900 p-1">
        <button
          type="button"
          onClick={() => onFitChange(!fit)}
          aria-pressed={fit}
          title="Make all cameras fit on the screen, with no scroll."
          className={`${TOGGLE_BUTTON} ${fit ? "bg-gray-700 text-white" : "text-gray-400 hover:text-gray-200"}`}
        >
          Fit to screen
        </button>
        <button
          id="arrange-button"
          type="button"
          onClick={onArrangeToggle}
          aria-expanded={arrangeOpen}
          aria-controls="arrange-panel"
          className={`${TOGGLE_BUTTON} ${
            arrangeOpen ? "bg-gray-700 text-white" : "text-gray-400 hover:text-gray-200"
          }`}
        >
          Arrange
        </button>
      </div>

      {pageCount > 1 && (
        <nav className="ml-auto flex items-center gap-2" aria-label="Pages">
          <button
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={page === 0}
            aria-label="Previous page"
            className="rounded-md bg-gray-900 p-1.5 text-gray-300 hover:text-white disabled:opacity-40 disabled:hover:text-gray-300"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path d="M12.79 5.23a.75.75 0 01-.02 1.06L8.83 10l3.94 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" />
            </svg>
          </button>
          <span className="min-w-24 text-center text-sm text-gray-400" aria-live="polite">
            Page {page + 1} of {pageCount}
          </span>
          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= pageCount - 1}
            aria-label="Next page"
            className="rounded-md bg-gray-900 p-1.5 text-gray-300 hover:text-white disabled:opacity-40 disabled:hover:text-gray-300"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path d="M7.21 14.77a.75.75 0 01.02-1.06L11.17 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" />
            </svg>
          </button>
        </nav>
      )}
    </div>
  );
}
