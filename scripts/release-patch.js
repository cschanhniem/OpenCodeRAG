import { execSync } from 'node:child_process';

const dry = process.env.DRY_RUN === '1' || process.argv.includes('--dry');

function run(cmd) {
  console.log('> ' + cmd);
  if (!dry) execSync(cmd, { stdio: 'inherit' });
  else console.log('(dry run) skipped');
}

try {
  if (!dry) run('git push origin main');
  else console.log('(dry run) would run: git push origin main');

  if (!dry) run('npm version patch');
  else console.log('(dry run) would run: npm version patch');

  const tag = execSync('git describe --tags --abbrev=0').toString().trim();
  console.log('Detected tag:', tag);

  run(`git push origin ${tag}`);
  run(`gh release create ${tag} --title "Version ${tag}" --notes "Patch release"`);
} catch (err) {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
}
