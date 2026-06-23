const fs = require("fs");
const p = require("path");
const a = process.argv.slice(2);
fs.mkdirSync(p.dirname(a[0]), { recursive: true });
try { fs.rmSync(a[0], { recursive: true, force: true }); } catch {}
fs.symlinkSync(a[1], a[0], "junction");
