import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sslChunker } from "../../chunker/ssl.js";

describe("SslChunker", () => {
  it("language is 'ssl'", () => {
    assert.equal(sslChunker.language, "ssl");
  });

  it("fileExtensions includes .ssl", () => {
    assert.ok(sslChunker.fileExtensions!.includes(".ssl"));
    assert.equal(sslChunker.fileExtensions!.length, 1);
  });

  it("chunk returns empty for empty content", async () => {
    const chunks = await sslChunker.chunk("test.ssl", "");
    assert.deepStrictEqual(chunks, []);
  });

  it("chunk returns single chunk for content without procedures", async () => {
    const code = ":DECLARE x;\n:DECLARE y;\nx := 1;";
    const chunks = await sslChunker.chunk("test.ssl", code);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0]!.metadata.startLine, 1);
    assert.equal(chunks[0]!.metadata.endLine, 3);
  });

  it("chunk extracts a single procedure", async () => {
    const code = [
      ":PROCEDURE Hello;",
      '  :PARAMETERS name;',
      '  :RETURN "Hello " + name;',
      ":ENDPROC;",
    ].join("\n");
    const chunks = await sslChunker.chunk("test.ssl", code);
    assert.equal(chunks.length, 1);
    assert.ok(chunks[0]!.content.includes("Hello"));
    assert.equal(chunks[0]!.metadata.startLine, 1);
    assert.equal(chunks[0]!.metadata.endLine, 4);
  });

  it("chunk extracts multiple procedures", async () => {
    const code = [
      ":PROCEDURE First;",
      '  x := 1;',
      ":ENDPROC;",
      "",
      ":PROCEDURE Second;",
      '  x := 2;',
      ":ENDPROC;",
    ].join("\n");
    const chunks = await sslChunker.chunk("test.ssl", code);
    assert.equal(chunks.length, 2);
    assert.ok(chunks[0]!.content.includes("First"));
    assert.ok(chunks[1]!.content.includes("Second"));
  });

  it("chunk handles procedure with nested :IF/:ENDIF", async () => {
    const code = [
      ":PROCEDURE Test;",
      "  :IF condition;",
      "    x := 1;",
      "  :ENDIF;",
      ":ENDPROC;",
    ].join("\n");
    const chunks = await sslChunker.chunk("test.ssl", code);
    assert.equal(chunks.length, 1);
    assert.ok(chunks[0]!.content.includes("Test"));
    assert.ok(chunks[0]!.content.includes(":IF"));
    assert.ok(chunks[0]!.content.includes(":ENDIF"));
  });

  it("chunk splits class into header + procedure chunks", async () => {
    const code = [
      ":CLASS MyClass;",
      ":INHERIT Base.Class;",
      ":DECLARE x;",
      ":PROCEDURE Init;",
      "  x := 1;",
      ":ENDPROC;",
      ":PROCEDURE Cleanup;",
      "  x := 0;",
      ":ENDPROC;",
      ":ENDCLASS;",
    ].join("\n");
    const chunks = await sslChunker.chunk("test.ssl", code);
    // Should have: class-header, Init, Cleanup
    assert.equal(chunks.length, 3, "expected class-header + 2 procedures");
    assert.ok(chunks[0]!.content.includes(":CLASS MyClass"));
    assert.ok(chunks[0]!.content.includes(":DECLARE x"), "class header should include declarations");
    assert.ok(chunks[1]!.content.includes(":PROCEDURE Init"));
    assert.ok(chunks[2]!.content.includes(":PROCEDURE Cleanup"));
  });

  it("chunk handles top-level code with procedures", async () => {
    const code = [
      "/* header comment */",
      'x := "start";',
      "",
      ":PROCEDURE DoSomething;",
      "  :DECLARE y;",
      "  y := 1;",
      ":ENDPROC;",
      "",
      'x := "done";',
    ].join("\n");
    const chunks = await sslChunker.chunk("test.ssl", code);
    assert.equal(chunks.length, 3, "expected pre-proc + proc + post-proc chunks");
    assert.ok(chunks[0]!.content.includes('x := "start"'), "pre-procedure top-level code");
    assert.ok(chunks[1]!.content.includes("DoSomething"), "procedure chunk");
    assert.ok(chunks[2]!.content.includes('x := "done"'), "post-procedure top-level code");
  });

  it("chunk generates unique IDs", async () => {
    const code = [
      ":PROCEDURE A; :ENDPROC;",
      ":PROCEDURE B; :ENDPROC;",
      ":PROCEDURE C; :ENDPROC;",
    ].join("\n");
    const chunks = await sslChunker.chunk("test.ssl", code);
    const ids = new Set(chunks.map((c) => c.id));
    assert.equal(ids.size, chunks.length);
  });

  it("chunk sets correct language metadata", async () => {
    const chunks = await sslChunker.chunk("test.ssl", ":PROCEDURE A;\nx:=1;\n:ENDPROC;");
    assert.equal(chunks[0]!.metadata.language, "ssl");
  });

  it("chunk sets correct filePath", async () => {
    const chunks = await sslChunker.chunk("/path/to/script.ssl", ":PROCEDURE A;\nx:=1;\n:ENDPROC;");
    assert.equal(chunks[0]!.metadata.filePath, "/path/to/script.ssl");
  });
});
