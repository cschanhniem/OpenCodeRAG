import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dockerfileChunker } from "../../chunker/dockerfile.js";

describe("DockerfileChunker", () => {
  it("language is 'dockerfile'", () => {
    assert.equal(dockerfileChunker.language, "dockerfile");
  });

  it("fileExtensions includes dockerfile and containerfile", () => {
    assert.ok(dockerfileChunker.fileExtensions.includes("dockerfile"));
    assert.ok(dockerfileChunker.fileExtensions.includes("containerfile"));
    assert.equal(dockerfileChunker.fileExtensions.length, 2);
  });

  it("grammarName is 'dockerfile'", () => {
    assert.equal(dockerfileChunker.grammarName, "dockerfile");
  });

  it("nodeTypes contains instruction types", () => {
    assert.ok(dockerfileChunker.nodeTypes.has("from_instruction"));
    assert.ok(dockerfileChunker.nodeTypes.has("run_instruction"));
    assert.ok(dockerfileChunker.nodeTypes.has("cmd_instruction"));
    assert.ok(dockerfileChunker.nodeTypes.has("entrypoint_instruction"));
    assert.ok(dockerfileChunker.nodeTypes.has("env_instruction"));
  });

  it("chunk returns empty array for empty content", async () => {
    const chunks = await dockerfileChunker.chunk("Dockerfile", "");
    assert.deepStrictEqual(chunks, []);
  });

  it("chunk extracts instructions", async () => {
    const code = `FROM node:20 AS build
WORKDIR /app
COPY package.json .
RUN npm install
CMD ["node", "server.js"]
`;
    const chunks = await dockerfileChunker.chunk("Dockerfile", code);
    assert.equal(chunks.length, 5);
    assert.ok(chunks[0]!.content.includes("FROM"));
    assert.ok(chunks[1]!.content.includes("WORKDIR"));
    assert.ok(chunks[2]!.content.includes("COPY"));
    assert.ok(chunks[3]!.content.includes("RUN"));
    assert.ok(chunks[4]!.content.includes("CMD"));
  });
});
