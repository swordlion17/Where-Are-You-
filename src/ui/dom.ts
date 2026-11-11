export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

/** Sets textContent only when it changed (cheap to call every frame). */
export function setText(el: HTMLElement, value: string | number): void {
  const v = String(value);
  if (el.textContent !== v) el.textContent = v;
}
