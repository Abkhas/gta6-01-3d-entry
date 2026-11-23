// Palma Verde — entrypoint: the dossier program.
//
// The grader runs this file on Node 22, twice, in a container where
// the repository is read-only and only the output directory is
// writable. It is not the game's boot script — the game boots itself
// from game/index.html in the browser, and nothing there loads this
// file. This file hands the game in: it copies game/ and screenshots/
// into the output directory and writes dossier.json with the kit's
// buildDossier, so the gate can check the entry and the judge can
// read it. Run it locally the same way:
//   MAKEFUN_OUTPUT_DIR=out node main.ts

import { cp, mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const REPO_ROOT = path.dirname(fileURLToPath(import.meta.url));

async function copyIfPresent(from: string, to: string): Promise<boolean> {
  try {
    await stat(from);
  } catch {
    return false;
  }
  await cp(from, to, { recursive: true });
  return true;
}

async function handIn(): Promise<void> {
  const outDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';
  const gameDir = path.join(REPO_ROOT, 'game');
  const shotsDir = path.join(REPO_ROOT, 'screenshots');
  await mkdir(outDir, { recursive: true });
  await cp(gameDir, path.join(outDir, 'game'), { recursive: true });
  await copyIfPresent(shotsDir, path.join(outDir, 'screenshots'));
  const caps = {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  };
  const dossier = buildDossier(REPO_ROOT, caps);
  await writeFile(path.join(outDir, 'dossier.json'), dossier);
}

handIn().catch((err: unknown) => {
  console.error('Palma Verde hand-in failed: ' + (err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
