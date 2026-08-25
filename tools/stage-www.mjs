/**
 * stage-www.mjs — Prépare le dossier www/ pour Capacitor.
 *
 * Copie uniquement les fichiers de l'app web (index.html, css/, js/, assets/,
 * manifest.json) vers www/, qui est le webDir embarqué dans l'APK.
 * sw.js n'est pas copié : dans la coquille Capacitor les fichiers sont déjà
 * locaux, le service worker est inutile (et app.js ne l'enregistre pas quand
 * window.Capacitor est présent).
 *
 * Usage : node tools/stage-www.mjs   (ou npm run stage)
 */
import { cpSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const www  = join(root, 'www');

rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });

for (const dir of ['css', 'js', 'assets']) {
  cpSync(join(root, dir), join(www, dir), { recursive: true });
}
for (const file of ['index.html', 'manifest.json']) {
  copyFileSync(join(root, file), join(www, file));
}

console.log('www/ prêt pour cap sync');
