# Helper: create a directory junction via Node.js (no admin required)
param([string]$LinkPath, [string]$TargetPath)

$code = @"
const fs = require('fs');
const path = require('path');
const link = process.argv[1];
const target = process.argv[2];
fs.mkdirSync(path.dirname(link), { recursive: true });
try { fs.rmSync(link, { recursive: true, force: true }); } catch {}
fs.symlinkSync(target, link, 'junction');
"@

& node -e $code -- $LinkPath $TargetPath
