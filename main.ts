// Palma Verde — entrypoint.
//
// This is the file the bounty harness runs. It mounts the game canvas,
// loads the game's own scripts in dependency order, and starts the loop.
// Every script it loads is authored in this repo; there are no vendor
// files, no network calls, and nothing to bundle.

const GAME_SCRIPTS: string[] = [
  'game/src/config.js',
  'game/src/world.js',
  'game/src/render.js',
  'game/src/player.js',
  'game/src/vehicles.js',
  'game/src/main.js',
];

const ERROR_BOX_ID = 'err';

function showError(message: string): void {
  const box = document.getElementById(ERROR_BOX_ID);
  if (box) {
    box.style.display = 'block';
    box.textContent = 'Palma Verde hit an error: ' + message;
  }
}

function loadScript(src: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const tag = document.createElement('script');
    tag.src = src;
    tag.onload = () => resolve();
    tag.onerror = () => reject(new Error('failed to load ' + src));
    document.head.appendChild(tag);
  });
}

async function boot(canvas: HTMLCanvasElement): Promise<void> {
  for (const src of GAME_SCRIPTS) {
    await loadScript(src);
  }
  const api = (window as unknown as { PalmaMain?: { startGame: (c: HTMLCanvasElement) => unknown } }).PalmaMain;
  if (!api) throw new Error('PalmaMain did not load');
  api.startGame(canvas);
}

function mount(): void {
  const canvas = document.getElementById('game') as HTMLCanvasElement | null;
  if (!canvas) {
    showError('canvas #game is missing');
    return;
  }
  boot(canvas).catch((err: unknown) => {
    showError(err instanceof Error ? err.message : String(err));
  });
}

window.addEventListener('error', (event: ErrorEvent) => {
  showError(event.message);
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}

export { boot, mount };
