// Palma Verde — static dev server.
//
// Serves the repo directory over HTTP so the game can be played and
// screenshotted in a desktop browser. No build step, no bundling, no
// network beyond the local machine. Run with:
//   deno run --allow-read --allow-net serve.ts [port]
// Defaults to port 8321.

const DEFAULT_PORT = 8321;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.ts': 'text/typescript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function contentType(path: string): string {
  const dot = path.lastIndexOf('.');
  const ext = dot >= 0 ? path.slice(dot) : '';
  return MIME[ext] ?? 'application/octet-stream';
}

function safeJoin(root: string, requestPath: string): string | null {
  const decoded = decodeURIComponent(requestPath);
  const clean = decoded.replace(/^\/+/, '').replace(/\.\./g, '');
  const joined = root + '/' + clean;
  if (!joined.startsWith(root)) return null;
  return joined;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const info = await Deno.stat(path);
    return info.isFile;
  } catch {
    return false;
  }
}

async function handler(request: Request, root: string): Promise<Response> {
  const url = new URL(request.url);
  let path = url.pathname;
  if (path === '/' || path === '') path = '/game/index.html';
  const file = safeJoin(root, path);
  if (file === null) return new Response('bad path', { status: 400 });
  let target = file;
  try {
    const info = await Deno.stat(target);
    if (info.isDirectory) target = target + '/index.html';
  } catch {
    return new Response('not found: ' + path, { status: 404 });
  }
  if (!(await fileExists(target))) {
    return new Response('not found: ' + path, { status: 404 });
  }
  const bytes = await Deno.readFile(target);
  return new Response(bytes, {
    status: 200,
    headers: { 'content-type': contentType(target) },
  });
}

function parsePort(argv: string[]): number {
  const raw = argv[0];
  if (!raw) return DEFAULT_PORT;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 && n < 65536 ? n : DEFAULT_PORT;
}

const port = parsePort(Deno.args);
const root = Deno.cwd();
console.log('Palma Verde dev server: http://localhost:' + port + '/  (root ' + root + ')');
Deno.serve({ port }, (request: Request) => handler(request, root));
