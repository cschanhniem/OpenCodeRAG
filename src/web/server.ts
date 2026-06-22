import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LanceDBStore } from "../vectorstore/lancedb.js";
import { KeywordIndex } from "../retriever/keyword-index.js";
import { createApiHandler } from "./api.js";
import { getStaticHtml } from "./static.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const uiDir = join(__dirname, "ui");

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
};

function serveStatic(res: ServerResponse, html: string): void {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function serveUiAsset(res: ServerResponse, filePath: string): void {
  try {
    const data = readFileSync(filePath);
    const ext = extname(filePath);
    const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  }
}

export interface WebUiServer {
  port: number;
  close: () => Promise<void>;
}

export async function startWebUi(
  storePath: string,
  port: number,
  cwd?: string,
  vectorDimension: number = 384
): Promise<WebUiServer> {
  const store = new LanceDBStore(storePath, vectorDimension);
  const keywordIndex = await KeywordIndex.load(storePath);

  const html = getStaticHtml();
  const apiHandler = createApiHandler(store, keywordIndex, storePath, cwd);

  const server: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "/";

    if (url === "/" || url === "/index.html") {
      serveStatic(res, html);
      return;
    }

    if (url.startsWith("/ui/")) {
      const assetPath = join(uiDir, url.slice("/ui/".length));
      serveUiAsset(res, assetPath);
      return;
    }

    if (url.startsWith("/api/")) {
      const handled = await apiHandler(req, res);
      if (handled) return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => {
      resolve({
        port,
        close: () =>
          new Promise<void>((resolveClose) => {
            server.close(() => resolveClose());
          }),
      });
    });
  });
}
