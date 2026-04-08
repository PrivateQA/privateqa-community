import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createLogger, type LogLevel } from "../utils/logger.js";

// ── Types ───────────────────────────────────────────────────────────────────

export type RouteContext = {
  req: IncomingMessage;
  res: ServerResponse;
  body: unknown;
  params: Record<string, string>;
  query: Record<string, string>;
  logger: ReturnType<typeof createLogger>;
};

type RouteHandler = (ctx: RouteContext) => Promise<void>;

type Route = {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: RouteHandler;
};

// ── Routeur minimaliste ─────────────────────────────────────────────────────

export class Router {
  private routes: Route[] = [];

  private add(method: string, path: string, handler: RouteHandler) {
    // Convertit "/api/results/:name" → RegExp + extraction de paramètres
    const paramNames: string[] = [];
    const pattern = path.replace(/:([a-zA-Z_]\w*)/g, (_m, name) => {
      paramNames.push(name);
      return "([^/]+)";
    });
    this.routes.push({
      method,
      pattern: new RegExp(`^${pattern}$`),
      paramNames,
      handler,
    });
  }

  get(path: string, handler: RouteHandler) {
    this.add("GET", path, handler);
  }
  post(path: string, handler: RouteHandler) {
    this.add("POST", path, handler);
  }
  delete(path: string, handler: RouteHandler) {
    this.add("DELETE", path, handler);
  }

  match(method: string, pathname: string) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = pathname.match(r.pattern);
      if (!m) continue;
      const params: Record<string, string> = {};
      r.paramNames.forEach((name, i) => {
        params[name] = decodeURIComponent(m[i + 1]!);
      });
      return { handler: r.handler, params };
    }
    return undefined;
  }
}

// ── Helpers HTTP ────────────────────────────────────────────────────────────

export function json(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(data, null, 2));
}

export function text(res: ServerResponse, msg: string, status = 200) {
  res.writeHead(status, {
    "Content-Type": "text/plain",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(msg);
}

export function sendFile(
  res: ServerResponse,
  buf: Buffer,
  contentType: string,
  status = 200,
) {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": buf.length,
    "Access-Control-Allow-Origin": "*",
  });
  res.end(buf);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(raw);
      }
    });
  });
}

function parseQuery(url: string): Record<string, string> {
  const idx = url.indexOf("?");
  if (idx < 0) return {};
  const qs: Record<string, string> = {};
  new URLSearchParams(url.slice(idx + 1)).forEach((v, k) => (qs[k] = v));
  return qs;
}

// ── Démarrage du serveur ────────────────────────────────────────────────────

export function startServer(router: Router, port: number, logLevel: LogLevel = "info") {
  const logger = createLogger(logLevel);

  const server = createServer(async (req, res) => {
    // CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return;
    }

    const url = req.url ?? "/";
    const pathname = url.split("?")[0]!;
    const method = req.method ?? "GET";
    const query = parseQuery(url);

    logger.debug(`${method} ${pathname}`);

    const match = router.match(method, pathname);
    if (!match) {
      json(res, { error: "Not Found", path: pathname }, 404);
      return;
    }

    try {
      const body = method === "POST" ? await readBody(req) : undefined;
      await match.handler({
        req,
        res,
        body,
        params: match.params,
        query,
        logger,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error(`${method} ${pathname} -> ${msg}`);
      json(res, { error: msg }, 500);
    }
  });

  server.listen(port, () => {
    logger.info(`privateqa API started on http://localhost:${port}`);
    logger.info(`Endpoints disponibles :`);
    logger.info(`  GET  /api/health`);
    logger.info(`  POST /api/preprocess`);
    logger.info(`  POST /api/compile`);
    logger.info(`  POST /api/run`);
    logger.info(`  GET  /api/results`);
    logger.info(`  GET  /api/results/steps`);
    logger.info(`  GET  /api/screenshots/:name`);
    logger.info(`  GET  /api/scenarios`);
    logger.info(`  DELETE /api/test-output`);
  });

  // ── Graceful shutdown : libérer le port à l'arrêt du processus ──────────
  const shutdown = () => {
    logger.info("Arrêt du serveur…");
    server.close(() => {
      logger.info("Serveur fermé, port libéré.");
      process.exit(0);
    });
    // Si le serveur ne se ferme pas en 3s, forcer la sortie
    setTimeout(() => process.exit(1), 3000).unref();
  };

  process.on("SIGINT", shutdown);   // Ctrl+C
  process.on("SIGTERM", shutdown);  // kill / arrêt système
  process.on("SIGHUP", shutdown);   // fermeture du terminal

  // Windows: capturer Ctrl+C via l'événement "exit" si SIGINT n'est pas relayé
  if (process.platform === "win32") {
    process.on("exit", () => {
      try { server.close(); } catch { /* ignore */ }
    });
  }

  return server;
}
