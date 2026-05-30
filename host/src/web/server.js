import http from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { validateSettings } from "./settings.js";

const DEFAULT_PUBLIC_DIR = fileURLToPath(new URL("./public", import.meta.url));

export function startWebServer({
  host = "127.0.0.1",
  port = 0,
  getView = () => ({}),
  saveSettings = () => {},
  framePath = "out/frame.png",
  publicDir = DEFAULT_PUBLIC_DIR,
} = {}) {
  const server = http.createServer(async (req, res) => {
    try {
      await routeRequest(req, res, { getView, saveSettings, framePath, publicDir });
    } catch (error) {
      respondJson(res, 500, { error: error.message });
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      const address = server.address();
      resolve({
        host: address.address,
        port: address.port,
        server,
        close: () => new Promise((done, fail) => server.close((error) => (error ? fail(error) : done()))),
      });
    });
  });
}

async function routeRequest(req, res, context) {
  const url = new URL(req.url, "http://127.0.0.1");

  if (req.method === "GET" && url.pathname === "/api/state") {
    respondJson(res, 200, await context.getView());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/settings") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      respondJson(res, 400, { error: error.message });
      return;
    }

    const result = validateSettings(body);
    if (!result.ok) {
      respondJson(res, 400, { error: result.error });
      return;
    }

    await context.saveSettings(result.value);
    respondJson(res, 200, { ok: true, settings: result.value });
    return;
  }

  if (req.method === "GET" && url.pathname === "/frame.png") {
    await serveFile(res, context.framePath, "image/png");
    return;
  }

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    await serveFile(res, join(context.publicDir, "index.html"), "text/html; charset=utf-8");
    return;
  }

  if (req.method === "GET" && url.pathname === "/app.js") {
    await serveFile(res, join(context.publicDir, "app.js"), "text/javascript; charset=utf-8");
    return;
  }

  respondJson(res, 404, { error: "not found" });
}

function readJsonBody(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > limit) {
        reject(new Error("request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body.length > 0 ? JSON.parse(body) : {});
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

async function serveFile(res, path, contentType) {
  try {
    const body = await readFile(path);
    res.writeHead(200, {
      "content-type": contentType,
      "cache-control": "no-store",
    });
    res.end(body);
  } catch (error) {
    if (error.code === "ENOENT") {
      respondJson(res, 404, { error: "not found" });
      return;
    }
    throw error;
  }
}

function respondJson(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}
