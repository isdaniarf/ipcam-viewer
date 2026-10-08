import type { Camera } from "../types/camera";

export function arrangeCameras(cameras: Camera[], order: string[]): Camera[] {
  const rank = new Map(order.map((name, index) => [name, index]));
  return cameras
    .map((camera, index) => ({ camera, rank: rank.get(camera.name) ?? order.length + index }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ camera }) => camera);
}

export function keepUnknownNames(names: string[], stored: string[]): string[] {
  const known = new Set(names);
  return [...names, ...stored.filter((name) => !known.has(name))];
}

export function swapNames(names: string[], first: string, second: string): string[] {
  const a = names.indexOf(first);
  const b = names.indexOf(second);
  if (a < 0 || b < 0) return names;
  const next = [...names];
  next[a] = second;
  next[b] = first;
  return next;
}

export function moveName(names: string[], name: string, target: string, after: boolean): string[] {
  if (name === target || !names.includes(name)) return names;
  const rest = names.filter((other) => other !== name);
  const index = rest.indexOf(target);
  if (index < 0) return names;
  rest.splice(after ? index + 1 : index, 0, name);
  return rest;
}

export function shiftName(names: string[], name: string, delta: number): string[] {
  const from = names.indexOf(name);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= names.length) return names;
  const next = [...names];
  next.splice(from, 1);
  next.splice(to, 0, name);
  return next;
}
