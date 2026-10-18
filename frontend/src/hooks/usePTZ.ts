import { useCallback, useEffect, useRef, useState } from "react";
import { fetchPresets, sendPTZ, type PTZCommand, type Preset } from "../lib/ptz";

const MOVE_REPEAT_MS = 400;

export interface Direction {
  pan: number;
  tilt: number;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sameDirection(a: Direction | null, b: Direction | null): boolean {
  if (a === null || b === null) return a === b;
  return a.pan === b.pan && a.tilt === b.tilt;
}

export function usePTZ(camera: string) {
  const [presets, setPresets] = useState<Preset[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [heading, setHeading] = useState<Direction | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const pending = useRef(0);
  const direction = useRef<Direction | null>(null);
  const repeatTimer = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchPresets(camera, controller.signal)
      .then(setPresets)
      .catch(() => {
        if (!controller.signal.aborted) setPresets(null);
      });
    return () => controller.abort();
  }, [camera]);

  const run = useCallback(
    (command: PTZCommand) => {
      pending.current += 1;
      const result = queue.current.then(() => sendPTZ(camera, command));
      queue.current = result
        .catch(() => undefined)
        .finally(() => {
          pending.current -= 1;
        });
      return result;
    },
    [camera],
  );

  const halt = useCallback(() => {
    window.clearInterval(repeatTimer.current);
    direction.current = null;
    setHeading(null);
  }, []);

  const move = useCallback(
    (next: Direction | null) => {
      if (sameDirection(direction.current, next)) return;
      window.clearInterval(repeatTimer.current);
      direction.current = next;
      setHeading(next);
      if (next === null) {
        run({ action: "stop" }).catch((error) => setProblem(messageOf(error)));
        return;
      }
      setProblem(null);
      const send = (always: boolean) => {
        if (!always && pending.current > 0) return;
        run({ action: "move", pan: next.pan, tilt: next.tilt }).catch((error) => {
          if (direction.current === next) halt();
          setProblem(messageOf(error));
        });
      };
      send(true);
      repeatTimer.current = window.setInterval(() => send(false), MOVE_REPEAT_MS);
    },
    [halt, run],
  );

  useEffect(() => {
    const stop = () => move(null);
    const stopWhenHidden = () => {
      if (document.visibilityState === "hidden") stop();
    };
    window.addEventListener("blur", stop);
    document.addEventListener("visibilitychange", stopWhenHidden);
    return () => {
      window.removeEventListener("blur", stop);
      document.removeEventListener("visibilitychange", stopWhenHidden);
      stop();
    };
  }, [move]);

  const presetCommand = useCallback(
    async (command: PTZCommand) => {
      setBusy(true);
      setProblem(null);
      try {
        const list = await run(command);
        if (list) setPresets(list);
        return true;
      } catch (error) {
        setProblem(messageOf(error));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [run],
  );

  const goTo = useCallback(
    (token: string) => {
      halt();
      return presetCommand({ action: "goto", preset: token });
    },
    [halt, presetCommand],
  );
  const save = useCallback((name: string) => presetCommand({ action: "save", name }), [presetCommand]);
  const remove = useCallback(
    (token: string) => presetCommand({ action: "remove", preset: token }),
    [presetCommand],
  );

  return {
    available: presets !== null,
    presets: presets ?? [],
    problem,
    busy,
    heading,
    move,
    goTo,
    save,
    remove,
  };
}
