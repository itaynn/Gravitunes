// Build test: a standalone dist/*.html travels alone, so it has no demo switcher and no links to other .html pages.
// Usage: node app/tools/test-standalone.mjs  (builds a few light demos into a temp folder)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const root = new URL('../../', import.meta.url).pathname;
const out = mkdtempSync(join(tmpdir(), 'gt-standalone-'));
try {
  for (const mode of ['scanning-line', 'storm-watch', 'synth-lab']) {
    execFileSync('python3', ['app/tools/build-standalone.py', '--mode', mode, '--variant', 'light', '--out', out], { cwd: root, stdio: 'pipe' });
  }
  const files = readdirSync(out).filter((f) => f.endsWith('.html'));
  assert.ok(files.includes('index.html') && files.length > 1, `built: ${files}`);
  for (const f of files) {
    const html = readFileSync(join(out, f), 'utf8');
    const links = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]).filter((h) => !/^(https?:|#|data:)/.test(h));
    if (f === 'index.html') { assert.ok(links.every((h) => /^[\w-]+\.html$/.test(h)), `index links: ${links}`); continue; }
    assert.deepEqual(links, [], `${f} links to other pages`);
    assert.ok(!/<nav id="gt-switcher"/.test(html), `${f} has the switcher element`);
    assert.ok(html.includes('__GT_STANDALONE__ = true'), `${f} lacks the standalone flag`);
  }
  for (const old of ['ozone-probe', 'layered-maps', 'mapping-lab', 'timbre-atlas', 'explore']) assert.ok(!files.includes(`${old}.html`), `${old} stub`);
  console.log(`standalone: ${files.length} files, no cross-demo links`);
} finally {
  rmSync(out, { recursive: true, force: true });
}
