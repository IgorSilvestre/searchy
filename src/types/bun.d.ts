// Minimal typing to appease TS when using Bun's `import.meta.main`.
// Bun sets `import.meta.main` at runtime; TS does not know this property by default.
interface ImportMeta {
  /** True when the current module is the program entrypoint (Bun). */
  main?: boolean;
}

