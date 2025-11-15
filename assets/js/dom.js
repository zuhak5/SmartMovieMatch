export const $ = (id) => document.getElementById(id);

export function closest(target, selector) {
  if (!selector || typeof selector !== "string") {
    return null;
  }
  if (!target) {
    return null;
  }
  const element =
    target instanceof Element
      ? target
      : target instanceof Node && target.parentElement
        ? target.parentElement
        : null;
  if (!element || typeof element.closest !== "function") {
    return null;
  }
  return element.closest(selector);
}
