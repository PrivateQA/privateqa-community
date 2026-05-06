/**
 * Pont de développement local.
 * Les specs générées importent depuis ce fichier (chemin relatif).
 * Tout le code réel vit dans src/base.ts (publié dans le package npm).
 */
import "dotenv/config";
import { appendFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { registerPlugin as registerLocalPlugin } from "../../src/base.js";

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

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

const enterpriseDistPath = path.resolve(process.cwd(), "enterprise", "dist", "index.js");
const licenseCandidates = [
  process.env.PRIVATEQA_LICENSE_PATH ?? "",
  ".privateqa/license.key",
  "license.key",
  "enterprise/license.key",
]
  .map((p) => p.trim())
  .filter((p) => p.length > 0)
  .map((p) => path.resolve(process.cwd(), p));
const hasEnterpriseDist = existsSync(enterpriseDistPath);
const hasAnyLicense = licenseCandidates.some((p) => existsSync(p));
const enterpriseAutoEnabled = hasEnterpriseDist && hasAnyLicense;
const enterpriseEnabled =
  isTruthy(process.env.PRIVATEQA_ENTERPRISE) || isTruthy(process.env.ENTREPRISE) || enterpriseAutoEnabled;
const enterpriseDebug = isTruthy(process.env.PRIVATEQA_DEBUG_HEAL);
const enterpriseRequireLicense = isTruthy(process.env.PRIVATEQA_ENTERPRISE_REQUIRE_LICENSE);
const OUTPUT_ROOT = process.env.TEST_OUTPUT_DIR ?? "test-output";
const DEV_HEAL_DEBUG_LOG = path.join(OUTPUT_ROOT, "logs", "heal-debug.log");
const ANSI_ESCAPE_REGEX = new RegExp(String.raw`\x1B\[[0-9;]*[ -/]*[@-~]`, "g");

async function appendDevDebug(message: string) {
  if (!enterpriseDebug) return;
  await mkdir(path.dirname(DEV_HEAL_DEBUG_LOG), { recursive: true });
  await appendFile(DEV_HEAL_DEBUG_LOG, `${new Date().toISOString()} [dev-bridge] ${message}\n`, "utf8");
}

async function checkOllamaReachability() {
  const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
  try {
    const res = await fetch(new URL("/api/tags", baseUrl), { signal: AbortSignal.timeout(2000) });
    await appendDevDebug(`ollama-check baseUrl=${baseUrl} status=${res.status} ok=${res.ok}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await appendDevDebug(`ollama-check baseUrl=${baseUrl} failed="${msg}"`);
  }
}

async function logLicenseStatus(enterpriseModule: Record<string, unknown>) {
  if (!enterpriseDebug) return;
  const loadLicense = enterpriseModule.loadEnterpriseLicense as
    | ((opts?: { requiredFeatures?: string[] }) => Promise<unknown>)
    | undefined;
  if (!loadLicense) {
    await appendDevDebug("license-check unavailable (loadEnterpriseLicense not exported)");
    return;
  }
  try {
    const status = await loadLicense({ requiredFeatures: ["heal"] });
    await appendDevDebug(`license-check ${JSON.stringify(status)}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await appendDevDebug(`license-check exception="${msg}"`);
  }
}

if (enterpriseEnabled) {
  try {
    const enterpriseModule = await import("../../enterprise/dist/index.js");
    if (enterpriseDebug && enterpriseModule.LlmHealConnector?.prototype) {
      const llmProto = enterpriseModule.LlmHealConnector.prototype as {
        heal: (request: unknown) => Promise<{
          suggestions?: Array<unknown>;
          model?: string;
          promptTokens?: number;
          responseTimeMs?: number;
          raw?: string;
        }>;
      };
      const originalHeal = llmProto.heal;
      llmProto.heal = async function patchedHeal(request: unknown) {
        const req = request as { stepLabel?: string; failedSelector?: string; pageUrl?: string };
        const connectorState = this as unknown as {
          baseUrl?: unknown;
          timeout?: unknown;
          retries?: unknown;
        };
        const connectorBaseUrl =
          typeof connectorState.baseUrl === "string"
            ? (connectorState.baseUrl ?? "(unknown)")
            : "(unknown)";
        const connectorTimeout =
          typeof connectorState.timeout === "number"
            ? String(connectorState.timeout)
            : "(unknown)";
        const connectorRetries =
          typeof connectorState.retries === "number"
            ? String(connectorState.retries)
            : "(unknown)";
        await appendDevDebug(
          `llm-heal request step="${req.stepLabel ?? "(unknown)"}" failedSelector="${req.failedSelector ?? "(unknown)"}" page="${req.pageUrl ?? "(unknown)"}" baseUrl="${connectorBaseUrl}" timeoutMs=${connectorTimeout} retries=${connectorRetries}`,
        );
        try {
          const response = await originalHeal.call(this, request);
          const suggestionsCount = Array.isArray(response?.suggestions) ? response.suggestions.length : 0;
          const rawPreview =
            typeof response?.raw === "string"
              ? response.raw.replace(/\s+/g, " ").slice(0, 500)
              : "(no-raw)";
          await appendDevDebug(
            `llm-heal response model=${response?.model ?? "(unknown)"} suggestions=${suggestionsCount} ` +
              `tokens=${response?.promptTokens ?? 0} durationMs=${response?.responseTimeMs ?? 0} raw="${rawPreview}"`,
          );
          return response;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const stack =
            error instanceof Error && typeof error.stack === "string"
              ? error.stack.replace(ANSI_ESCAPE_REGEX, "").replace(/\s+/g, " ").slice(0, 1200)
              : "(no-stack)";
          await appendDevDebug(`llm-heal exception message="${message}" stack="${stack}"`);
          throw error;
        }
      };
      await appendDevDebug("llm-heal patch enabled (dev bridge)");
    }
    if (typeof enterpriseModule.createHealerPlugin === "function") {
      if (enterpriseDebug) {
        console.log("[qa-debug] enterprise=true -> chargement plugin enterprise");
      }
      const plugin = enterpriseModule.createHealerPlugin({
        onHealSuccess: async (record: unknown, suggestion: unknown) => {
          if (!enterpriseDebug) return;
          await appendDevDebug(
            `onHealSuccess ${JSON.stringify({
              record,
              suggestion,
            })}`,
          );
          console.log("[qa-debug] heal-success", { record, suggestion });
        },
        onHealFailure: async (error: unknown, ctx: unknown) => {
          if (!enterpriseDebug) return;
          const message = error instanceof Error ? error.message : String(error);
          const context = ctx as { stepIndex?: number; label?: string; error?: Error };
          await appendDevDebug(
            `onHealFailure step=${context?.stepIndex ?? "?"} label="${context?.label ?? "?"}" ` +
              `message="${message}" originalError="${context?.error?.message?.replace(ANSI_ESCAPE_REGEX, "").slice(0, 300) ?? ""}"`,
          );
          console.log("[qa-debug] heal-failure", { message, ctx });
        },
      });
      const pluginToRegister =
        enterpriseRequireLicense && typeof enterpriseModule.guardHealPlugin === "function"
          ? enterpriseModule.guardHealPlugin(plugin, {
              onDenied: async (error: Error) => {
                if (!enterpriseDebug) return;
                console.log("[qa-debug] license-denied", {
                  status: "feature_denied_or_invalid_license",
                  message: error.message,
                });
              },
            })
          : plugin;
      const wrappedPlugin = {
        ...pluginToRegister,
        name: `${pluginToRegister.name}-dev-debug`,
        onTestBegin: async (page: unknown, testInfo: unknown) => {
          await appendDevDebug(
            `onTestBegin licenseGuard=${enterpriseRequireLicense ? "enabled" : "disabled"} ` +
              `licensePath=${process.env.PRIVATEQA_LICENSE_PATH ?? "license.key"} ` +
              `instance=${process.env.PRIVATEQA_INSTANCE_ID ?? "(unset)"}`,
          );
          await checkOllamaReachability();
          if (enterpriseRequireLicense) {
            await logLicenseStatus(enterpriseModule as unknown as Record<string, unknown>);
          }
          if (pluginToRegister.onTestBegin) {
            await pluginToRegister.onTestBegin(page as never, testInfo as never);
          }
        },
        onStepFailure: async (ctx: unknown) => {
          const stepCtx = ctx as { stepIndex: number; label: string; error: Error };
          await appendDevDebug(
            `onStepFailure enter step=${stepCtx.stepIndex} label="${stepCtx.label}" ` +
              `error="${(stepCtx.error?.message ?? "unknown").replace(ANSI_ESCAPE_REGEX, "").slice(0, 200)}"`,
          );
          try {
            if (!pluginToRegister.onStepFailure) {
              await appendDevDebug("onStepFailure missing on plugin -> fail");
              return { action: "fail" } as const;
            }
            const result = await pluginToRegister.onStepFailure(ctx as never);
            await appendDevDebug(
              `onStepFailure result step=${stepCtx.stepIndex} action=${result.action} ` +
                `${result.action === "retry" ? `hasNewFn=${typeof result.newFn === "function"}` : ""}`,
            );
            return result;
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            await appendDevDebug(`onStepFailure exception step=${stepCtx.stepIndex} message="${msg}"`);
            throw error;
          }
        },
        onTestEnd: async (page: unknown, _testInfo: unknown) => {
          await appendDevDebug("onTestEnd");
          if (pluginToRegister.onTestEnd) {
            await pluginToRegister.onTestEnd(page as never, _testInfo as never);
          }
        },
      };
      registerLocalPlugin(wrappedPlugin);
      if (enterpriseDebug) {
        console.log("[qa-debug] plugin enterprise enregistré", {
          licenseGuard: enterpriseRequireLicense ? "enabled" : "disabled-dev-mode",
        });
      }
    } else if (typeof enterpriseModule.activate === "function") {
      // Fallback pour compatibilité ancienne API.
      enterpriseModule.activate();
      if (enterpriseDebug) {
        console.log("[qa-debug] activate() enterprise appelé");
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `PRIVATEQA_ENTERPRISE=true mais le plugin enterprise n'est pas disponible. ` +
        `Lancez 'npm --prefix enterprise run build' puis réessayez. Détail: ${message}`,
    );
  }
}
