// Palma Verde 3D: the hand-in program for the gta6-01 bounty.
//
// The grader runs this file on Node 22, twice, inside a container where the
// repository is read-only and only the output directory is writable. This is
// not the game's boot script: the game starts itself from game/index.html in
// the browser, and nothing there loads this file. All this file does is hand
// the entry in: it stages game/ (and screenshots/, when the renders exist)
// into the output directory and writes the dossier for the repo.
//
// Run it as: MAKEFUN_OUTPUT_DIR=/tmp/palma3d-out node main.ts

import { cp, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDossier } from "./vendor/makefun-game.ts";

// The folder holding this file is the repo root: game/ and screenshots/
// both live beside it.
const repoRoot = path.dirname(fileURLToPath(import.meta.url));

// Where the finished entry goes; the grader points this at its own
// writable directory, and /output is the fallback when it says nothing.
const outputDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";

// The bounty gate's caps, exactly as the gate states them.
const dossierCaps = {
  text_max_bytes: 163840,
  screenshots: {
    max: 4,
    max_bytes: 262144,
  },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

// True when `dir` exists and is a directory; false for anything else,
// including a path that is simply not there yet.
async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

// Stage the entry and write its dossier. Any failure is reported by the
// caller, which exits non-zero.
async function handIn(): Promise<void> {
  await mkdir(outputDir, { recursive: true });

  await cp(path.join(repoRoot, "game"), path.join(outputDir, "game"), {
    recursive: true,
  });

  const shotsDir = path.join(repoRoot, "screenshots");
  if (await isDirectory(shotsDir)) {
    await cp(shotsDir, path.join(outputDir, "screenshots"), {
      recursive: true,
    });
  }

  const dossier = buildDossier(repoRoot, dossierCaps);
  await writeFile(path.join(outputDir, "dossier.json"), dossier);
}

handIn().catch((error: unknown) => {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`main.ts: hand-in failed: ${detail}`);
  process.exit(1);
});
