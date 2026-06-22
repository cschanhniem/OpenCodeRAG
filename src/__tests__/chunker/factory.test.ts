import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getChunker, chunkFile } from "../../chunker/factory.js";

describe("getChunker", () => {
  it("returns TypeScript chunker for .ts files", () => {
    const chunker = getChunker("src/app.ts");
    assert.equal(chunker.language, "typescript");
  });

  it("returns TypeScript chunker for .tsx files", () => {
    const chunker = getChunker("src/Component.tsx");
    assert.equal(chunker.language, "typescript");
  });

  it("returns markdown chunker for .md files", () => {
    const chunker = getChunker("readme.md");
    assert.equal(chunker.language, "markdown");
  });

  it("returns Python chunker for .py files", () => {
    const chunker = getChunker("main.py");
    assert.equal(chunker.language, "python");
  });

  it("returns Java chunker for .java files", () => {
    const chunker = getChunker("Main.java");
    assert.equal(chunker.language, "java");
  });

  it("returns Go chunker for .go files", () => {
    const chunker = getChunker("main.go");
    assert.equal(chunker.language, "go");
  });

  it("returns bash chunker for .sh files", () => {
    const chunker = getChunker("script.sh");
    assert.equal(chunker.language, "bash");
  });

  it("returns PHP chunker for .php files", () => {
    const chunker = getChunker("index.php");
    assert.equal(chunker.language, "php");
  });

  it("returns PowerShell chunker for .ps1 files", () => {
    const chunker = getChunker("script.ps1");
    assert.equal(chunker.language, "powershell");
  });

  it("returns PowerShell chunker for .psm1 files", () => {
    const chunker = getChunker("module.psm1");
    assert.equal(chunker.language, "powershell");
  });

  it("returns INI chunker for .ini files", () => {
    const chunker = getChunker("config.ini");
    assert.equal(chunker.language, "ini");
  });

  it("returns INI chunker for .cfg files", () => {
    const chunker = getChunker("config.cfg");
    assert.equal(chunker.language, "ini");
  });

  it("returns YAML chunker for .yaml files", () => {
    const chunker = getChunker("config.yaml");
    assert.equal(chunker.language, "yaml");
  });

  it("returns YAML chunker for .yml files", () => {
    const chunker = getChunker("config.yml");
    assert.equal(chunker.language, "yaml");
  });

  it("returns TOML chunker for .toml files", () => {
    const chunker = getChunker("config.toml");
    assert.equal(chunker.language, "toml");
  });

  it("returns SQL chunker for .sql files", () => {
    const chunker = getChunker("query.sql");
    assert.equal(chunker.language, "sql");
  });

  it("returns Dockerfile chunker for Dockerfile", () => {
    const chunker = getChunker("Dockerfile");
    assert.equal(chunker.language, "dockerfile");
  });

  it("returns Dockerfile chunker for Containerfile", () => {
    const chunker = getChunker("Containerfile");
    assert.equal(chunker.language, "dockerfile");
  });

  it("returns fallback chunker for unknown extensions", () => {
    const chunker = getChunker("script.xyz");
    assert.equal(chunker.language, "text");
  });

  it("returns fallback chunker for files without extension", () => {
    const chunker = getChunker("Makefile");
    assert.equal(chunker.language, "text");
  });

  it("handles uppercase extensions", () => {
    const chunker = getChunker("Component.TSX");
    assert.equal(chunker.language, "typescript");
  });

  it("handles paths with dots in directory names", () => {
    const chunker = getChunker("dir.with.dots/app.ts");
    assert.equal(chunker.language, "typescript");
  });

  it("returns C chunker for .c files", () => {
    const chunker = getChunker("main.c");
    assert.equal(chunker.language, "c");
  });

  it("returns C chunker for .h files", () => {
    const chunker = getChunker("header.h");
    assert.equal(chunker.language, "c");
  });

  it("returns C++ chunker for .cpp files", () => {
    const chunker = getChunker("main.cpp");
    assert.equal(chunker.language, "cpp");
  });

  it("returns C++ chunker for .cc files", () => {
    const chunker = getChunker("main.cc");
    assert.equal(chunker.language, "cpp");
  });

  it("returns C# chunker for .cs files", () => {
    const chunker = getChunker("Program.cs");
    assert.equal(chunker.language, "csharp");
  });

  it("returns JavaScript chunker for .js files", () => {
    const chunker = getChunker("app.js");
    assert.equal(chunker.language, "javascript");
  });

  it("returns JavaScript chunker for .jsx files", () => {
    const chunker = getChunker("Component.jsx");
    assert.equal(chunker.language, "javascript");
  });

  it("returns JavaScript chunker for .mjs files", () => {
    const chunker = getChunker("module.mjs");
    assert.equal(chunker.language, "javascript");
  });

  it("returns Razor chunker for .razor files", () => {
    const chunker = getChunker("Component.razor");
    assert.equal(chunker.language, "razor");
  });

  it("returns Razor chunker for .cshtml files", () => {
    const chunker = getChunker("view.cshtml");
    assert.equal(chunker.language, "razor");
  });

  it("returns JSON chunker for .json files", () => {
    const chunker = getChunker("package.json");
    assert.equal(chunker.language, "json");
  });

  it("returns HTML chunker for .html files", () => {
    const chunker = getChunker("index.html");
    assert.equal(chunker.language, "html");
  });

  it("returns HTML chunker for .htm files", () => {
    const chunker = getChunker("page.htm");
    assert.equal(chunker.language, "html");
  });

  it("returns CSS chunker for .css files", () => {
    const chunker = getChunker("styles.css");
    assert.equal(chunker.language, "css");
  });

  it("returns XML chunker for .csproj files", () => {
    const chunker = getChunker("MyProject.csproj");
    assert.equal(chunker.language, "xml");
  });

  it("returns XML chunker for .xml files", () => {
    const chunker = getChunker("config.xml");
    assert.equal(chunker.language, "xml");
  });

  it("returns XML chunker for .svg files", () => {
    const chunker = getChunker("icon.svg");
    assert.equal(chunker.language, "xml");
  });

  it("returns SLN chunker for .sln files", () => {
    const chunker = getChunker("MySolution.sln");
    assert.equal(chunker.language, "sln");
  });

  it("returns Rust chunker for .rs files", () => {
    const chunker = getChunker("main.rs");
    assert.equal(chunker.language, "rust");
  });

  it("returns Ruby chunker for .rb files", () => {
    const chunker = getChunker("app.rb");
    assert.equal(chunker.language, "ruby");
  });

  it("returns Kotlin chunker for .kt files", () => {
    const chunker = getChunker("main.kt");
    assert.equal(chunker.language, "kotlin");
  });

  it("returns Kotlin chunker for .kts files", () => {
    const chunker = getChunker("script.kts");
    assert.equal(chunker.language, "kotlin");
  });

  it("returns Swift chunker for .swift files", () => {
    const chunker = getChunker("main.swift");
    assert.equal(chunker.language, "swift");
  });

  it("returns SSL chunker for .ssl files", () => {
    const chunker = getChunker("script.ssl");
    assert.equal(chunker.language, "ssl");
  });
});

describe("chunkFile fallback", () => {
  it("falls back to line-based chunking when primary chunker returns 0 chunks", async () => {
    const code = "let x = 1;";
    const chunks = await chunkFile("test.ts", code);
    assert.ok(chunks.length > 0, "expected fallback to produce at least one chunk");
  });

  it("does not double-fallback when fallback itself returns 0 chunks", async () => {
    const chunks = await chunkFile("empty.ts", "");
    assert.deepStrictEqual(chunks, []);
  });
});

describe("chunkFile oversize splitting", () => {
  it("splits oversized JSON pair into sub-chunks <= 100 lines", async () => {
    const entries: string[] = [];
    for (let i = 0; i < 50; i++) {
      entries.push(
        `    "dep-${String(i).padStart(3, "0")}": {\n` +
        `      "version": "${i}.0.0",\n` +
        `      "resolved": "https://registry.example.com/dep-${i}/-/${i}.0.0.tgz",\n` +
        `      "integrity": "sha512-${"a".repeat(40)}"\n` +
        `    }`
      );
    }
    const content = `{\n  "packages": {\n${entries.join(",\n")}\n  }\n}`;

    const chunks = await chunkFile("large.json", content);

    assert.ok(chunks.length > 1, "expected multiple chunks from oversized file");
    for (const chunk of chunks) {
      assert.equal(
        chunk.metadata.language,
        "json",
        `chunk language should be json, got ${chunk.metadata.language}`
      );
      const lineCount = chunk.content.split("\n").length;
      assert.ok(
        lineCount <= 100,
        `chunk has ${lineCount} lines, expected <= 100`
      );
    }
  });

  it("splits oversized chunk on char limit even when lines are few", async () => {
    const longLine = "x".repeat(200);
    const lines: string[] = [];
    for (let i = 0; i < 60; i++) {
      lines.push(longLine);
    }

    const chunks = await chunkFile("wide.txt", lines.join("\n"));

    assert.ok(chunks.length > 1, "expected character-limit to split into multiple chunks");
    for (const chunk of chunks) {
      assert.equal(chunk.metadata.language, "text");
      assert.ok(
        chunk.content.length <= 8000,
        `chunk has ${chunk.content.length} chars, expected <= 8000`
      );
    }
  });

  it("preserves all original content across sub-chunks", async () => {
    const lines: string[] = [];
    for (let i = 0; i < 150; i++) {
      lines.push(`line-${String(i).padStart(4, "0")}`);
    }
    const content = lines.join("\n");

    const chunks = await chunkFile("lines.txt", content);
    const combined = chunks.map((c) => c.content).join("\n");

    assert.equal(combined, content, "combined sub-chunk content must equal original");
  });

  it("preserves line number metadata after splitting", async () => {
    const lines: string[] = [];
    for (let i = 0; i < 150; i++) {
      lines.push(`line-${String(i).padStart(4, "0")}`);
    }
    const content = lines.join("\n");

    const chunks = await chunkFile("lines.txt", content);
    assert.ok(chunks.length > 1);

    let expectedLine = 1;
    for (const chunk of chunks) {
      assert.equal(chunk.metadata.startLine, expectedLine);
      expectedLine += chunk.content.split("\n").length;
    }
  });
});

describe("chunkFile with nodeTypes overrides", () => {
  it("applies nodeTypes override to chunk a file differently", async () => {
    const code = "class Foo {\n  bar() { return 1; }\n  baz() { return 2; }\n}";
    const chunksDefault = await chunkFile("test.ts", code);
    const chunksOverride = await chunkFile("test.ts", code, {
      typescript: ["function_declaration", "method_definition", "class_declaration", "arrow_function"],
    });
    assert.ok(chunksDefault.length > 0, "default should produce chunks");
    assert.ok(chunksOverride.length > 0, "override should produce chunks");
    assert.ok(chunksOverride.some((c) => c.content.includes("class Foo")), "override should include class-level chunk");
  });

  it("ignores override for non-tree-sitter languages", async () => {
    const code = "just some text";
    const chunks = await chunkFile("test.txt", code, { text: ["paragraph"] });
    assert.ok(chunks.length > 0, "should fall back to line-based chunking");
  });
});
