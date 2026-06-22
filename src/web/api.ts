import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { extname, resolve as resolvePathModule } from "node:path";
import { LanceDBStore } from "../vectorstore/lancedb.js";
import { KeywordIndex } from "../retriever/keyword-index.js";
import { listSessions, getSession, deleteSession, compareSessions, validateSessionID } from "../eval/storage.js";
import { analyzeTokenUsage, compareTokenAnalyses, projectTokenSavings } from "../eval/token-analysis.js";

const FILE_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
};

interface ApiResponse {
  status: number;
  body: unknown;
}

function parseQuery(url: string): { path: string; params: URLSearchParams } {
  const [path, queryString] = url.split("?");
  return {
    path: path ?? "/",
    params: new URLSearchParams(queryString ?? ""),
  };
}

function sendJson(res: ServerResponse, response: ApiResponse): void {
  res.writeHead(response.status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(response.body));
}

export function createApiHandler(store: LanceDBStore, keywordIndex: KeywordIndex, storePath: string, cwd?: string) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";
    const { path, params } = parseQuery(url);

    // CORS preflight
    if (method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return true;
    }

    let response: ApiResponse;

    try {
      // Existing endpoints
      if (path === "/api/stats") {
        response = await handleStats(store);
      } else if (path === "/api/files") {
        response = await handleFiles(store);
      } else if (path === "/api/chunks" && !path.includes("/api/chunks/")) {
        response = await handleChunks(store, params);
      } else if (path.startsWith("/api/chunks/")) {
        const id = path.slice("/api/chunks/".length);
        response = await handleChunkById(store, id);
      } else if (path === "/api/search") {
        response = await handleSearch(keywordIndex, params);
      } else if (path === "/api/compare") {
        response = await handleCompare(store, params);
      }
      // File content endpoint (for serving images)
      else if (path === "/api/file" && method === "GET") {
        if (cwd) {
          response = handleFileContent(cwd, params);
        } else {
          response = { status: 400, body: { error: "Workspace path not configured" } };
        }
      }
      // Eval endpoints
      else if (path === "/api/eval/sessions" && method === "GET") {
        response = await handleEvalSessions(storePath);
      } else if (path.startsWith("/api/eval/sessions/") && method === "GET") {
        const id = path.slice("/api/eval/sessions/".length);
        response = await handleEvalSession(storePath, id);
      } else if (path.startsWith("/api/eval/sessions/") && method === "DELETE") {
        const id = path.slice("/api/eval/sessions/".length);
        response = await handleEvalDeleteSession(storePath, id);
      }       else if (path === "/api/eval/compare" && method === "GET") {
        response = await handleEvalCompare(storePath, params);
      }
      // Token analysis endpoints
      else if (path.startsWith("/api/eval/sessions/") && path.endsWith("/analysis") && method === "GET") {
        const id = path.slice("/api/eval/sessions/".length, -"/analysis".length);
        response = await handleEvalAnalysis(storePath, id);
      } else if (path === "/api/eval/token-compare" && method === "GET") {
        response = await handleEvalTokenCompare(storePath, params);
      } else if (path === "/api/eval/project-savings" && method === "POST") {
        const body = await readBody(req);
        response = handleEvalProjectSavings(body);
      } else {
        return false;
      }

      sendJson(res, response);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, { status: 500, body: { error: message } });
      return true;
    }
  };
}

async function handleStats(store: LanceDBStore): Promise<ApiResponse> {
  const totalChunks = await store.count();
  const files = await store.listFiles();

  const langMap = new Map<string, number>();
  for (const file of files) {
    langMap.set(file.language, (langMap.get(file.language) ?? 0) + file.chunkCount);
  }

  const languages = [...langMap.entries()]
    .map(([language, count]) => ({ language, count }))
    .sort((a, b) => b.count - a.count);

  return {
    status: 200,
    body: {
      totalChunks,
      totalFiles: files.length,
      languages,
    },
  };
}

async function handleFiles(store: LanceDBStore): Promise<ApiResponse> {
  const files = await store.listFiles();
  return { status: 200, body: files };
}

async function handleChunks(
  store: LanceDBStore,
  params: URLSearchParams
): Promise<ApiResponse> {
  const offset = parseInt(params.get("offset") ?? "0", 10);
  const limit = parseInt(params.get("limit") ?? "50", 10);
  const langFilter = params.get("lang");
  const fileFilter = params.get("file");

  const allChunks = await store.getChunks(0, 100000);

  let filtered = allChunks;

  if (langFilter) {
    filtered = filtered.filter((c) => c.language === langFilter);
  }

  if (fileFilter) {
    filtered = filtered.filter((c) => c.filePath.startsWith(fileFilter));
  }

  const total = filtered.length;
  const chunks = filtered.slice(offset, offset + limit);

  return {
    status: 200,
    body: { chunks, total, offset, limit },
  };
}

async function handleChunkById(
  store: LanceDBStore,
  id: string
): Promise<ApiResponse> {
  const chunks = await store.getChunks(0, 100000);
  const chunk = chunks.find((c) => c.id === id);

  if (!chunk) {
    return { status: 404, body: { error: "Chunk not found" } };
  }

  return { status: 200, body: chunk };
}

async function handleSearch(
  keywordIndex: KeywordIndex,
  params: URLSearchParams
): Promise<ApiResponse> {
  const query = params.get("q") ?? "";
  const topK = parseInt(params.get("topK") ?? "20", 10);

  if (!query.trim()) {
    return { status: 200, body: { results: [] } };
  }

  const results = keywordIndex.search(query, topK);

  return {
    status: 200,
    body: {
      results: results.map((r) => ({
        chunk: {
          id: r.chunk.id,
          filePath: r.chunk.metadata.filePath,
          startLine: r.chunk.metadata.startLine,
          endLine: r.chunk.metadata.endLine,
          language: r.chunk.metadata.language,
          content: r.chunk.content,
          description: r.chunk.description,
        },
        score: Math.round(r.score * 1000) / 1000,
      })),
    },
  };
}

async function handleCompare(
  store: LanceDBStore,
  params: URLSearchParams
): Promise<ApiResponse> {
  const idsParam = params.get("ids") ?? "";
  const ids = idsParam.split(",").filter(Boolean);

  if (ids.length === 0) {
    return { status: 400, body: { error: "No chunk IDs provided" } };
  }

  const allChunks = await store.getChunks(0, 100000);
  const chunks = allChunks.filter((c) =>
    ids.includes((c as unknown as { id?: string }).id ?? "")
  );

  return { status: 200, body: { chunks } };
}

// ── File Content API ──────────────────────────────────────────────────

function handleFileContent(cwd: string, params: URLSearchParams): ApiResponse {
  const filePath = params.get("path");
  if (!filePath) {
    return { status: 400, body: { error: "Missing 'path' query parameter" } };
  }

  const resolved = resolvePath(cwd, filePath);
  if (!resolved) {
    return { status: 403, body: { error: "Invalid file path" } };
  }

  try {
    const data = readFileSync(resolved);
    const ext = extname(resolved).toLowerCase();
    const mime = FILE_MIME_TYPES[ext] ?? "application/octet-stream";
    const b64 = data.toString("base64");
    return { status: 200, body: { data: b64, mime } };
  } catch {
    return { status: 404, body: { error: "File not found" } };
  }
}

function resolvePath(cwd: string, filePath: string): string | null {
  const resolved = resolvePathModule(cwd, filePath);
  const normalizedCwd = cwd.replace(/\\/g, "/");
  const normalizedResolved = resolved.replace(/\\/g, "/");
  if (!normalizedResolved.startsWith(normalizedCwd)) return null;
  return resolved;
}

// ── Eval API ──────────────────────────────────────────────────────────

async function handleEvalSessions(storePath: string): Promise<ApiResponse> {
  const sessions = listSessions(storePath);
  return { status: 200, body: { sessions } };
}

async function handleEvalSession(storePath: string, id: string): Promise<ApiResponse> {
  if (!validateSessionID(id)) {
    return { status: 400, body: { error: "Invalid session ID" } };
  }
  const session = getSession(storePath, id);
  if (!session) {
    return { status: 404, body: { error: "Session not found" } };
  }
  return { status: 200, body: session };
}

async function handleEvalDeleteSession(storePath: string, id: string): Promise<ApiResponse> {
  if (!validateSessionID(id)) {
    return { status: 400, body: { error: "Invalid session ID" } };
  }
  deleteSession(storePath, id);
  return { status: 200, body: { deleted: true } };
}

async function handleEvalCompare(storePath: string, params: URLSearchParams): Promise<ApiResponse> {
  const idA = params.get("a") ?? "";
  const idB = params.get("b") ?? "";

  if (!idA || !idB) {
    return { status: 400, body: { error: "Both 'a' and 'b' session IDs are required" } };
  }

  if (!validateSessionID(idA) || !validateSessionID(idB)) {
    return { status: 400, body: { error: "Invalid session ID" } };
  }

  const result = compareSessions(storePath, idA, idB);
  if (!result) {
    return { status: 404, body: { error: "One or both sessions not found" } };
  }

  return { status: 200, body: result };
}

// ── Token Analysis API ────────────────────────────────────────────────

export async function handleEvalAnalysis(storePath: string, id: string): Promise<ApiResponse> {
  if (!validateSessionID(id)) {
    return { status: 400, body: { error: "Invalid session ID" } };
  }
  const session = getSession(storePath, id);
  if (!session) {
    return { status: 404, body: { error: "Session not found" } };
  }
  const analysis = analyzeTokenUsage(storePath, id);
  return { status: 200, body: { analysis } };
}

export async function handleEvalTokenCompare(storePath: string, params: URLSearchParams): Promise<ApiResponse> {
  const idA = params.get("a") ?? "";
  const idB = params.get("b") ?? "";

  if (!idA || !idB) {
    return { status: 400, body: { error: "Both 'a' and 'b' session IDs are required" } };
  }
  if (!validateSessionID(idA) || !validateSessionID(idB)) {
    return { status: 400, body: { error: "Invalid session ID" } };
  }

  const sessionA = getSession(storePath, idA);
  const sessionB = getSession(storePath, idB);
  if (!sessionA || !sessionB) {
    return { status: 404, body: { error: "One or both sessions not found" } };
  }

  const analysisA = analyzeTokenUsage(storePath, idA);
  const analysisB = analyzeTokenUsage(storePath, idB);
  const comparison = compareTokenAnalyses(analysisA, analysisB);

  return { status: 200, body: { ragOn: analysisA, ragOff: analysisB, comparison } };
}

export function handleEvalProjectSavings(body: unknown): ApiResponse {
  if (!body || typeof body !== "object") {
    return { status: 400, body: { error: "Request body required" } };
  }
  const b = body as Record<string, unknown>;
  const avgChunkSize = Number(b.avgChunkSize);
  const avgChunksPerQuery = Number(b.avgChunksPerQuery);
  const avgReadsPerQueryWithoutRAG = Number(b.avgReadsPerQueryWithoutRAG);
  const avgReadsPerQueryWithRAG = Number(b.avgReadsPerQueryWithRAG);
  const queryCount = Number(b.queryCount);

  if ([avgChunkSize, avgChunksPerQuery, avgReadsPerQueryWithoutRAG, avgReadsPerQueryWithRAG, queryCount].some(isNaN)) {
    return { status: 400, body: { error: "All projection parameters must be numbers" } };
  }

  const projection = projectTokenSavings({
    avgChunkSize,
    avgChunksPerQuery,
    avgReadsPerQueryWithoutRAG,
    avgReadsPerQueryWithRAG,
    queryCount,
  });

  return { status: 200, body: { projection } };
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
}
