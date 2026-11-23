// dev/flow-test-3d.mjs — headless-Chrome drive of Palma Verde 3D.
//
// Serves the repo root on port 8321 (reusing a server already there,
// starting one when none answers), then loads the integrated game in
// the full Chromium at ~/.cache/ms-playwright/chromium-1148 — the
// headless_shell binary renders blank, do NOT use it — and asserts:
// the title page boots with zero errors, all four ?shot= URLs render
// a non-blank canvas, and the HUD updates on a shot page. Each check
// prints PASS or FAIL; any failure exits non-zero.
// Run: node dev/flow-test-3d.mjs
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8321;
const CHROME = path.join(
  process.env.HOME || '/home/hatch',
  '.cache/ms-playwright/chromium-1148/chrome-linux/chrome'
);
const BASE = 'http://127.0.0.1:' + PORT + '/game/index.html';

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('PASS ' + name); }
  else { failed++; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

// ---- static server (repo root) -----------------------------------------
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml'
};
function serve() {
  return http.createServer((req, res) => {
    try {
      const url = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
      const file = path.join(ROOT, url);
      if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
      });
    } catch (e) {
      res.writeHead(500); res.end(String(e));
    }
  });
}
async function serverUp() {
  try {
    const res = await fetch(BASE, { signal: AbortSignal.timeout(1500) });
    const text = await res.text();
    return res.ok && text.indexOf('PALMA VERDE') !== -1;
  } catch (e) {
    return false;
  }
}
let server = null;
async function ensureServer() {
  if (await serverUp()) {
    console.log('server: reusing http://127.0.0.1:' + PORT);
    return;
  }
  server = serve();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });
  console.log('server: started http://127.0.0.1:' + PORT);
  if (!(await serverUp())) throw new Error('server started but does not answer');
}

// ---- headless chrome -----------------------------------------------------
function runChrome(url) {
  return new Promise((resolve, reject) => {
    const args = [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
      '--window-size=1280,720', '--run-all-compositor-stages-before-draw',
      '--virtual-time-budget=6000', '--timeout=12000',
      '--dump-dom', '--enable-logging=stderr', '--v=0', url
    ];
    execFile(CHROME, args, { timeout: 45000, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && !stdout) return reject(new Error('chrome failed: ' + err.message + ' :: ' + String(stderr).slice(0, 500)));
      resolve({ dom: stdout || '', log: stderr || '' });
    });
  });
}
function testStatus(dom) {
  const m = dom.match(/id="test-status"[^>]*>([\s\S]*?)<\/div>/);
  if (!m) return null;
  try { return JSON.parse(m[1].trim()); } catch (e) { return { parseError: String(e), raw: m[1].slice(0, 200) }; }
}
function badConsoleLines(log) {
  return log.split('\n').filter(function (line) {
    return /Uncaught|net::ERR_|Failed to load resource|CONSOLE.*(Error|error)/.test(line);
  });
}

// ---- the pages -----------------------------------------------------------
const PAGES = [
  { name: 'title', url: BASE, shot: 'title' },
  { name: 'chase', url: BASE + '?shot=chase&seed=1', shot: 'chase' },
  { name: 'night', url: BASE + '?shot=night&seed=2', shot: 'night' },
  { name: 'systems', url: BASE + '?shot=systems&seed=3', shot: 'systems' },
  { name: 'heli', url: BASE + '?shot=heli&seed=4', shot: 'heli' }
];

async function main() {
  if (!fs.existsSync(CHROME)) {
    console.log('FAIL chrome binary missing: ' + CHROME);
    process.exit(1);
  }
  await ensureServer();
  try {
    for (const page of PAGES) {
      let run;
      try {
        run = await runChrome(page.url);
      } catch (e) {
        check(page.name + ': chrome loads the page', false, e.message);
        continue;
      }
      const status = testStatus(run.dom);
      check(page.name + ': #test-status reports', !!status && !status.parseError,
        status ? (status.parseError || status.raw || '') : 'no #test-status in DOM');
      if (!status || status.parseError) continue;
      check(page.name + ': zero game errors', Array.isArray(status.errors) && status.errors.length === 0,
        JSON.stringify(status.errors || []).slice(0, 300));
      const bad = badConsoleLines(run.log);
      check(page.name + ': zero console errors', bad.length === 0, bad.slice(0, 3).join(' | ').slice(0, 300));
      check(page.name + ': canvas element sized 1280 wide', /<canvas id="world"[^>]*width="1280"/.test(run.dom),
        (run.dom.match(/<canvas id="world"[^>]*>/) || ['no canvas'])[0]);
      if (page.shot === 'title') {
        check('title: title screen visible', run.dom.indexOf('PALMA VERDE') !== -1, 'no PALMA VERDE text in DOM');
        check('title: shot status is title', status.shot === 'title', JSON.stringify(status.shot));
      } else {
        check(page.name + ': non-blank canvas', typeof status.nonBlank === 'number' && status.nonBlank > 0.05,
          'nonBlank=' + status.nonBlank);
        check(page.name + ': canvas has light in it', typeof status.meanLuma === 'number' && status.meanLuma > 5,
          'meanLuma=' + status.meanLuma);
        check(page.name + ': HUD updated (mission panel in DOM)', /pv3d-mission/.test(run.dom), 'no pv3d-mission node');
      }
      if (page.shot === 'chase') {
        check('chase: HUD names Old Town Score', /OLD TOWN SCORE/i.test(run.dom), 'mission title missing from DOM');
        check('chase: wanted 4 in status', status.wanted === 4, 'wanted=' + status.wanted);
        check('chase: footer strip set', run.dom.indexOf('shot=chase&amp;seed=1') !== -1 || run.dom.indexOf('shot=chase&seed=1') !== -1, 'footer missing');
      }
      if (page.shot === 'night') {
        check('night: wanted 2 in status', status.wanted === 2, 'wanted=' + status.wanted);
        check('night: muzzle flash chip in DOM', run.dom.indexOf('✦') !== -1, 'no flash chip');
      }
      if (page.shot === 'systems') {
        check('systems: completion 48% in status', typeof status.completion === 'number' && Math.abs(status.completion - 48) <= 1,
          'completion=' + status.completion);
        check('systems: systems screen visible', /COMPLETION|Completion/.test(run.dom), 'no completion text in DOM');
        check('systems: showSystems ran and stayed visible', status.screensProbe === 'called, visible=true',
          'screensProbe=' + status.screensProbe);
      }
      if (page.shot === 'heli') {
        check('heli: wanted 2 in status', status.wanted === 2, 'wanted=' + status.wanted);
        check('heli: Gull tag in DOM', run.dom.indexOf('THE GULL') !== -1, 'no Gull tag');
      }
    }
  } finally {
    if (server) server.close();
  }
  console.log('\nflow-test-3d: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}

main().catch(function (e) {
  console.log('FAIL flow-test harness: ' + (e && e.message ? e.message : e));
  if (server) server.close();
  process.exit(1);
});
