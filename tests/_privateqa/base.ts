/**
 * Pont de développement local.
 * Les specs générées importent depuis ce fichier (chemin relatif).
 * Tout le code réel vit dans src/base.ts (publié dans le package npm).
 */
import "dotenv/config";

export {
  test,
  expect,
  qaStep,
  registerPlugin,
  clearPlugins,
  getPlugins,
} from "../../src/base.js";

export type {
  StepResult,
  QAPlugin,
  StepContext,
  StepInterceptorResult,
} from "../../src/base.js";
