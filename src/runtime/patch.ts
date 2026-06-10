import type { WorldState } from "./types";

export type PatchOperation =
  | {
      op: "set";
      path: Array<string | number>;
      value: unknown;
    }
  | {
      op: "inc";
      path: Array<string | number>;
      value: number;
    }
  | {
      op: "append";
      path: Array<string | number>;
      value: unknown;
    };

export type WorldStatePatch = PatchOperation[];

function getAtPath(target: unknown, path: Array<string | number>): unknown {
  let current = target;
  for (const key of path) {
    if (current == null) {
      return undefined;
    }
    current = (current as Record<string | number, unknown>)[key as string];
  }
  return current;
}

function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return [...value];
  }
  if (value && typeof value === "object") {
    return { ...(value as Record<string, unknown>) };
  }
  return value;
}

function setIn(target: unknown, path: Array<string | number>, value: unknown): unknown {
  if (path.length === 0) {
    return value;
  }

  const [key, ...rest] = path;
  const current = target && typeof target === "object" ? cloneValue(target) : {};
  if (rest.length === 0) {
    if (Array.isArray(current)) {
      const nextArray = [...current];
      nextArray[key as number] = value;
      return nextArray;
    }
    return {
      ...(current as Record<string, unknown>),
      [key as string]: value,
    };
  }

  const nextSub = setIn((current as Record<string, unknown>)[key as string], rest, value);
  if (Array.isArray(current)) {
    const nextArray = [...current];
    nextArray[key as number] = nextSub;
    return nextArray;
  }

  return {
    ...(current as Record<string, unknown>),
    [key as string]: nextSub,
  };
}

export function applyWorldStatePatch(state: WorldState, patch: WorldStatePatch): WorldState {
  return patch.reduce<WorldState>((currentState, operation) => {
    switch (operation.op) {
      case "set": {
        return setIn(currentState, operation.path, operation.value) as WorldState;
      }
      case "inc": {
        const currentValue = getAtPath(currentState, operation.path);
        const nextValue = (typeof currentValue === "number" ? currentValue : 0) + operation.value;
        return setIn(currentState, operation.path, nextValue) as WorldState;
      }
      case "append": {
        const currentValue = getAtPath(currentState, operation.path);
        const nextArray = Array.isArray(currentValue) ? [...currentValue, operation.value] : [operation.value];
        return setIn(currentState, operation.path, nextArray) as WorldState;
      }
      default:
        return currentState;
    }
  }, state);
}
