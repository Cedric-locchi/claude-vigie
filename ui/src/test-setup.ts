// jsdom n'implémente pas ResizeObserver, utilisé par les popovers spartan (autocomplete, select).
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};
