// ── privateqa-community — Public API ────────────────────────────────────────

// Plugin system
export type { QAPlugin, StepContext, StepInterceptorResult } from "./core/plugin.js";
export { registerPlugin, getPlugins, clearPlugins } from "./core/plugin.js";

// Error utilities
export { isLocatorError, enrichErrorMessage } from "./core/errors.js";

// Step types
export type { QAStep } from "./core/steps.js";
export { stepsFromMarkdown, toStep, parseStepsFromMarkdown } from "./core/steps.js";

// Infrastructure types
export type { MapFile, MappedElement, LocatorHint } from "./infrastructure/store.js";
export { LocalVectorStore } from "./infrastructure/store.js";

// Builder
export type { CompileOptions } from "./agents/builder/builder.js";
export { compileToSpec } from "./agents/builder/builder.js";
