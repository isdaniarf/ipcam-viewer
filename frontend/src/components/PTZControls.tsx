import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent } from "react";
import { usePTZ, type Direction } from "../hooks/usePTZ";
import { PRESET_NAME_LIMIT, UNSAFE_PRESET_CHARACTERS } from "../lib/ptz";

const SPEED = 0.5;
const HIDDEN_STORAGE_KEY = "ipcam-viewer.ptz-hidden";
const ARROW_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

interface PadButton {
  label: string;
  pan: number;
  tilt: number;
  angle: number;
}

const PAD: (PadButton | null)[] = [
  { label: "Up and left", pan: -1, tilt: 1, angle: -45 },
  { label: "Up", pan: 0, tilt: 1, angle: 0 },
  { label: "Up and right", pan: 1, tilt: 1, angle: 45 },
  { label: "Left", pan: -1, tilt: 0, angle: -90 },
  null,
  { label: "Right", pan: 1, tilt: 0, angle: 90 },
  { label: "Down and left", pan: -1, tilt: -1, angle: -135 },
  { label: "Down", pan: 0, tilt: -1, angle: 180 },
  { label: "Down and right", pan: 1, tilt: -1, angle: 135 },
];

function directionOf(button: PadButton): Direction {
  return { pan: button.pan * SPEED, tilt: button.tilt * SPEED };
}

function readHidden(): boolean {
  try {
    return localStorage.getItem(HIDDEN_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function storeHidden(hidden: boolean): void {
  try {
    if (hidden) localStorage.setItem(HIDDEN_STORAGE_KEY, "1");
    else localStorage.removeItem(HIDDEN_STORAGE_KEY);
  } catch (error) {
    console.warn("The browser blocked localStorage.", error);
  }
}

function isTextField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function presetNameProblem(name: string): string | null {
  if (name === "") return "Type a name.";
  if (UNSAFE_PRESET_CHARACTERS.test(name)) return "The camera cannot keep < > or & in a name.";
  return null;
}

function MoveIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
      <path d="M10 1.5l2.5 3h-1.75v4.75h4.75V7.5l3 2.5-3 2.5v-1.75h-4.75v4.75h1.75l-2.5 3-2.5-3h1.75v-4.75H4.5v1.75l-3-2.5 3-2.5v1.75h4.75V4.5H7.5l2.5-3z" />
    </svg>
  );
}

function ArrowIcon({ angle }: { angle: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-5 w-5"
      style={{ transform: `rotate(${angle}deg)` }}
      aria-hidden="true"
    >
      <path d="M10 3.5l5.5 7h-3.75v6h-3.5v-6H4.5l5.5-7z" />
    </svg>
  );
}

export function PTZControls({ camera }: { camera: string }) {
  const { available, presets, problem, busy, heading, move, goTo, save, remove } = usePTZ(camera);
  const [hidden, setHidden] = useState(readHidden);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [nameProblem, setNameProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const nameField = useRef<HTMLInputElement>(null);
  const active = available && !hidden;

  useEffect(() => {
    if (!active) return;
    const held = new Set<string>();
    const update = () => {
      const pan = (held.has("ArrowRight") ? 1 : 0) - (held.has("ArrowLeft") ? 1 : 0);
      const tilt = (held.has("ArrowUp") ? 1 : 0) - (held.has("ArrowDown") ? 1 : 0);
      move(pan === 0 && tilt === 0 ? null : { pan: pan * SPEED, tilt: tilt * SPEED });
    };
    const press = (event: globalThis.KeyboardEvent) => {
      if (!ARROW_KEYS.has(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
      if (isTextField(event.target)) return;
      event.preventDefault();
      if (held.has(event.key)) return;
      held.add(event.key);
      update();
    };
    const release = (event: globalThis.KeyboardEvent) => {
      if (!held.delete(event.key)) return;
      event.preventDefault();
      update();
    };
    const forget = () => held.clear();
    document.addEventListener("keydown", press);
    document.addEventListener("keyup", release);
    window.addEventListener("blur", forget);
    return () => {
      document.removeEventListener("keydown", press);
      document.removeEventListener("keyup", release);
      window.removeEventListener("blur", forget);
      move(null);
    };
  }, [active, move]);

  if (!available) return null;

  const changeHidden = (next: boolean) => {
    setHidden(next);
    storeHidden(next);
  };

  if (hidden) {
    return (
      <button
        type="button"
        onClick={() => changeHidden(false)}
        className="absolute bottom-20 right-4 z-10 rounded-full bg-black/60 p-3 text-white hover:bg-black/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        aria-label="Show the pan and tilt controls"
        title="Pan and tilt"
      >
        <MoveIcon className="h-6 w-6" />
      </button>
    );
  }

  const pressPad = (event: PointerEvent<HTMLButtonElement>, button: PadButton) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    move(directionOf(button));
  };

  const keyPad = (event: KeyboardEvent<HTMLButtonElement>, button: PadButton | null) => {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    if (event.type === "keyup") move(null);
    else if (!event.repeat && button) move(directionOf(button));
  };

  const startNaming = () => {
    setName("");
    setNameProblem(null);
    setNaming(true);
  };

  const submitName = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    const found = presetNameProblem(trimmed);
    setNameProblem(found);
    if (found) {
      nameField.current?.focus();
      return;
    }
    if (await save(trimmed)) setNaming(false);
    else nameField.current?.focus();
  };

  const removePreset = (token: string) => {
    if (confirming !== token) {
      setConfirming(token);
      return;
    }
    setConfirming(null);
    void remove(token);
  };

  return (
    <section
      aria-label="Pan and tilt"
      className="absolute bottom-20 right-4 z-10 w-[23rem] max-w-[calc(100vw-2rem)] rounded-xl bg-black/70 p-3 text-white shadow-lg backdrop-blur-sm"
    >
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-medium">Pan and tilt</h2>
        <button
          type="button"
          onClick={() => changeHidden(true)}
          className="rounded-md p-1 text-gray-300 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-white"
          aria-label="Hide the pan and tilt controls"
          title="Hide"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" aria-hidden="true">
            <path d="M5.22 8.22a.75.75 0 011.06 0L10 11.94l3.72-3.72a.75.75 0 111.06 1.06l-4.25 4.25a.75.75 0 01-1.06 0L5.22 9.28a.75.75 0 010-1.06z" />
          </svg>
        </button>
      </div>

      <div className="flex items-start gap-3">
        <div
          role="group"
          aria-label="Directions"
          aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
          title="Hold an arrow, or hold the arrow keys."
          className="grid shrink-0 touch-none select-none grid-cols-3 gap-1"
          onContextMenu={(event) => event.preventDefault()}
        >
          {PAD.map((button, index) =>
            button ? (
              <button
                key={button.label}
                type="button"
                aria-label={`Move ${button.label.toLowerCase()}`}
                onPointerDown={(event) => pressPad(event, button)}
                onPointerUp={() => move(null)}
                onPointerCancel={() => move(null)}
                onLostPointerCapture={() => move(null)}
                onKeyDown={(event) => keyPad(event, button)}
                onKeyUp={(event) => keyPad(event, null)}
                className={`flex h-11 w-11 items-center justify-center rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-white ${
                  heading && heading.pan === button.pan * SPEED && heading.tilt === button.tilt * SPEED
                    ? "bg-sky-500 text-white"
                    : "bg-white/10 text-gray-100 hover:bg-white/20"
                }`}
              >
                <ArrowIcon angle={button.angle} />
              </button>
            ) : (
              <span key={index} className="flex h-11 w-11 items-center justify-center text-gray-500" aria-hidden="true">
                <MoveIcon className="h-4 w-4" />
              </span>
            ),
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">Presets</h3>
          {presets.length === 0 && <p className="mb-2 text-xs text-gray-400">No saved positions yet.</p>}
          <ul className="mb-2 flex flex-wrap gap-1">
            {presets.map((preset) => (
              <li key={preset.token} className="flex overflow-hidden rounded-md bg-white/10">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void goTo(preset.token)}
                  className="max-w-36 truncate px-2 py-1 text-xs hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-white disabled:opacity-50"
                  title={`Go to ${preset.name}`}
                >
                  {preset.name}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => removePreset(preset.token)}
                  onBlur={() => setConfirming((current) => (current === preset.token ? null : current))}
                  className={`px-1.5 py-1 text-xs focus-visible:outline-2 focus-visible:outline-white disabled:opacity-50 ${
                    confirming === preset.token ? "bg-red-600 text-white" : "text-gray-400 hover:bg-white/20 hover:text-white"
                  }`}
                  aria-label={confirming === preset.token ? `Confirm: remove ${preset.name}` : `Remove ${preset.name}`}
                >
                  {confirming === preset.token ? "Remove?" : "×"}
                </button>
              </li>
            ))}
          </ul>

          {naming ? (
            <form onSubmit={submitName} className="flex flex-col gap-1">
              <input
                ref={nameField}
                autoFocus
                value={name}
                maxLength={PRESET_NAME_LIMIT}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Escape") return;
                  event.stopPropagation();
                  setNaming(false);
                }}
                placeholder="Name of this position"
                aria-label="Preset name"
                aria-invalid={nameProblem !== null}
                className="w-full rounded-md border border-white/20 bg-black/40 px-2 py-1 text-xs text-white placeholder:text-gray-500"
              />
              <div className="flex gap-1">
                <button
                  type="submit"
                  disabled={busy}
                  className="flex-1 rounded-md bg-sky-600 px-2 py-1 text-xs font-medium hover:bg-sky-500 focus-visible:outline-2 focus-visible:outline-white disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setNaming(false)}
                  className="flex-1 rounded-md px-2 py-1 text-xs text-gray-300 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white"
                >
                  Cancel
                </button>
              </div>
              {nameProblem && <p className="text-xs text-red-300">{nameProblem}</p>}
            </form>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={startNaming}
              className="w-full rounded-md bg-white/10 px-2 py-1 text-xs hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-white disabled:opacity-50"
            >
              Save this position
            </button>
          )}
        </div>
      </div>

      {problem && (
        <p role="alert" className="mt-2 break-words text-xs text-red-300">
          {problem}
        </p>
      )}
    </section>
  );
}
