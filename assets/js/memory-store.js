const memoryStore = new Map();

export function getItem(key) {
  if (typeof key !== "string") {
    return null;
  }
  return memoryStore.has(key) ? memoryStore.get(key) : null;
}

export function setItem(key, value) {
  if (typeof key !== "string") {
    return;
  }
  memoryStore.set(key, value);
}

export function removeItem(key) {
  if (typeof key !== "string") {
    return;
  }
  memoryStore.delete(key);
}

export function clear() {
  memoryStore.clear();
}
