/**
 * subset-fontawesome.mjs — Génère un sous-ensemble Font Awesome (fontes + CSS)
 * limité aux icônes réellement utilisées dans le projet.
 *
 * DÉTECTION AUTOMATIQUE : le script scanne js/**\/*.js, index.html et css/**\/*.css
 * pour trouver les classes `fa-xxx`. Quand vous ajoutez une icône dans le code,
 * il suffit de relancer le script — pas de liste à maintenir à la main.
 *
 * PRÉREQUIS : le paquet npm `subset-font` (harfbuzz WASM, pur JS).
 *   - soit installé dans le projet :        npm i --no-save subset-font
 *   - soit installé dans un dossier tiers : npm i --prefix <dir> subset-font
 *     puis :                                node tools/subset-fontawesome.mjs --modules <dir>/node_modules
 *
 * USAGE (depuis la racine du projet) :
 *   node tools/subset-fontawesome.mjs [--modules <chemin/vers/node_modules>]
 *
 * ENTRÉES  : assets/fontawesome/css/fontawesome.min.css (mapping classe → codepoint)
 *            assets/fontawesome/webfonts/fa-solid-900.woff2 / fa-regular-400.woff2 (originaux, conservés)
 * SORTIES  : assets/fontawesome/webfonts/fa-solid-900.subset.woff2
 *            assets/fontawesome/webfonts/fa-regular-400.subset.woff2
 *            assets/fontawesome/css/fa-subset.min.css
 *
 * Après régénération : rien d'autre à faire (index.html et sw.js pointent déjà
 * vers fa-subset.min.css et les .subset.woff2), mais penser à bumper
 * CACHE_VERSION dans sw.js pour invalider le precache.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FA_DIR = join(ROOT, 'assets', 'fontawesome');

// --- Résolution de subset-font (projet ou --modules <dir>) -----------------
async function loadSubsetFont() {
  const mIdx = process.argv.indexOf('--modules');
  const candidates = [];
  if (mIdx !== -1 && process.argv[mIdx + 1]) {
    candidates.push(join(resolve(process.argv[mIdx + 1]), 'subset-font', 'index.js'));
  }
  candidates.push(join(ROOT, 'node_modules', 'subset-font', 'index.js'));
  for (const c of candidates) {
    try {
      statSync(c);
      const mod = await import(pathToFileURL(c).href);
      return mod.default || mod;
    } catch { /* essayer le suivant */ }
  }
  console.error('ERREUR : paquet "subset-font" introuvable.');
  console.error('Installez-le :  npm i --no-save subset-font');
  console.error('ou :            npm i --prefix <dir> subset-font  puis  --modules <dir>/node_modules');
  process.exit(1);
}

// --- 1. Scan des sources : quelles icônes / utilitaires sont utilisés ? ----
// Classes utilitaires FA (pas des icônes) : celles-ci sont détectées séparément.
const UTILITIES = new Set([
  'fa-solid', 'fa-regular', 'fa-classic', 'fa-brands', 'fa-light', 'fa-thin', 'fa-duotone', 'fa-sharp',
  'fa-2xs', 'fa-xs', 'fa-sm', 'fa-lg', 'fa-xl', 'fa-2xl',
  'fa-1x', 'fa-2x', 'fa-3x', 'fa-4x', 'fa-5x', 'fa-6x', 'fa-7x', 'fa-8x', 'fa-9x', 'fa-10x',
  'fa-fw', 'fa-width-auto', 'fa-width-fixed', 'fa-ul', 'fa-li', 'fa-border', 'fa-pull-left', 'fa-pull-right',
  'fa-spin', 'fa-spin-pulse', 'fa-spin-reverse', 'fa-pulse', 'fa-beat', 'fa-fade', 'fa-beat-fade',
  'fa-bounce', 'fa-flip', 'fa-shake',
  'fa-rotate-90', 'fa-rotate-180', 'fa-rotate-270', 'fa-rotate-by',
  'fa-flip-horizontal', 'fa-flip-vertical', 'fa-flip-both',
  'fa-stack', 'fa-stack-1x', 'fa-stack-2x', 'fa-inverse', 'fa-swap-opacity',
]);

function* walk(dir, ext) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p, ext);
    else if (ext.some((e) => entry.name.endsWith(e))) yield p;
  }
}

const sourceFiles = [
  join(ROOT, 'index.html'),
  ...walk(join(ROOT, 'js'), ['.js']),
  ...walk(join(ROOT, 'css'), ['.css']),
];

const solidIcons = new Set();
const regularIcons = new Set();
const usedUtilities = new Set();
const unclassified = new Set(); // icônes vues sans fa-solid/fa-regular adjacent (ex. sélecteurs CSS)

const ICON_RE = /fa-[a-z0-9][a-z0-9-]*/g;
for (const file of sourceFiles) {
  const text = readFileSync(file, 'utf8');
  // Classement par co-occurrence dans la même liste de classes (les deux ordres).
  for (const m of text.matchAll(/fa-(solid|regular)((?:\s+fa-[a-z0-9][a-z0-9-]*)+)/g)) {
    const target = m[1] === 'solid' ? solidIcons : regularIcons;
    for (const cls of m[2].match(ICON_RE) || []) {
      if (UTILITIES.has(cls)) usedUtilities.add(cls);
      else target.add(cls);
    }
  }
  for (const m of text.matchAll(/((?:fa-[a-z0-9][a-z0-9-]*\s+)+)fa-(solid|regular)/g)) {
    const target = m[2] === 'solid' ? solidIcons : regularIcons;
    for (const cls of m[1].match(ICON_RE) || []) {
      if (UTILITIES.has(cls)) usedUtilities.add(cls);
      else target.add(cls);
    }
  }
  // Toutes les occurrences (attrape utilitaires et icônes isolées, ex. sélecteurs CSS).
  for (const cls of text.match(ICON_RE) || []) {
    if (UTILITIES.has(cls)) usedUtilities.add(cls);
    else if (!solidIcons.has(cls) && !regularIcons.has(cls)) unclassified.add(cls);
  }
}
usedUtilities.delete('fa-solid');
usedUtilities.delete('fa-regular');
usedUtilities.delete('fa-classic');

// --- 2. Mapping classe → glyphe depuis fontawesome.min.css -----------------
const coreCss = readFileSync(join(FA_DIR, 'css', 'fontawesome.min.css'), 'utf8');
const glyphOf = new Map(); // 'fa-xmark' → '' (caractère littéral)
for (const m of coreCss.matchAll(/((?:\.fa-[a-z0-9-]+,?)+)\{--fa:"([^"]+)"\}/g)) {
  for (const sel of m[1].split(',')) glyphOf.set(sel.slice(1), m[2]);
}
// Règles utilitaires : extraites telles quelles du CSS d'origine.
function utilityRule(cls) {
  const re = new RegExp(`(?<![a-z0-9-])\\.${cls.replace(/-/g, '\\-')}\\{[^{}]*\\}`);
  const m = coreCss.match(re);
  return m ? m[0] : null;
}

// Les icônes non classées (vues seules, ex. sélecteurs CSS) vont dans solid par
// défaut — mais seulement si ce sont de vraies icônes FA (filtre les noms de
// fichiers comme "fa-subset" ou "fa-solid-900" croisés dans les sources).
for (const cls of unclassified) {
  if (!solidIcons.has(cls) && !regularIcons.has(cls) && glyphOf.has(cls)) solidIcons.add(cls);
}

const missing = [...solidIcons, ...regularIcons].filter((c) => !glyphOf.has(c));
if (missing.length) {
  console.error('ERREUR : icônes introuvables dans fontawesome.min.css :', missing.join(', '));
  process.exit(1);
}

const fmt = (set) => [...set].sort().join(', ');
console.log(`Icônes solid   (${solidIcons.size}) : ${fmt(solidIcons)}`);
console.log(`Icônes regular (${regularIcons.size}) : ${fmt(regularIcons)}`);
console.log(`Utilitaires    (${usedUtilities.size}) : ${fmt(usedUtilities)}`);

// --- 3. Subset des woff2 -----------------------------------------------------
const subsetFont = await loadSubsetFont();
const jobs = [
  { src: 'fa-solid-900.woff2', out: 'fa-solid-900.subset.woff2', icons: solidIcons },
  { src: 'fa-regular-400.woff2', out: 'fa-regular-400.subset.woff2', icons: regularIcons },
];
for (const job of jobs) {
  const srcPath = join(FA_DIR, 'webfonts', job.src);
  const buf = readFileSync(srcPath);
  const text = [...job.icons].map((c) => glyphOf.get(c)).join('');
  const out = await subsetFont(buf, text, { targetFormat: 'woff2' });
  const outPath = join(FA_DIR, 'webfonts', job.out);
  writeFileSync(outPath, out);
  console.log(`${job.src} : ${buf.length} o -> ${job.out} : ${out.length} o (${job.icons.size} glyphes)`);
}

// --- 4. CSS minimal ----------------------------------------------------------
const esc = (glyph) => [...glyph].map((ch) => '\\' + ch.codePointAt(0).toString(16)).join('');
const allIcons = new Map(); // classe → glyphe (dédupliqué solid+regular)
for (const c of [...solidIcons, ...regularIcons].sort()) allIcons.set(c, glyphOf.get(c));

const cssParts = [
  '/*! Sous-ensemble Font Awesome Pro 7.2.0 (https://fontawesome.com) — genere par tools/subset-fontawesome.mjs. License Commerciale - https://fontawesome.com/license */',
  ':host,:root{--fa-family-classic:"Font Awesome 7 Pro";--fa-font-solid:normal 900 1em/1 var(--fa-family-classic);--fa-font-regular:normal 400 1em/1 var(--fa-family-classic);--fa-style-family-classic:var(--fa-family-classic)}',
  '@font-face{font-family:"Font Awesome 7 Pro";font-style:normal;font-weight:900;font-display:block;src:url(../webfonts/fa-solid-900.subset.woff2) format("woff2")}',
  '@font-face{font-family:"Font Awesome 7 Pro";font-style:normal;font-weight:400;font-display:block;src:url(../webfonts/fa-regular-400.subset.woff2) format("woff2")}',
  '.fa,.fa-solid,.fa-regular,.fa-classic{--_fa-family:var(--fa-family,var(--fa-style-family,"Font Awesome 7 Pro"));-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;display:var(--fa-display,inline-block);font-family:var(--_fa-family);font-feature-settings:normal;font-style:normal;font-synthesis:none;font-variant:normal;font-weight:var(--fa-style,900);line-height:1;text-align:center;text-rendering:auto;width:var(--fa-width,1.25em)}',
  ':is(.fa,.fa-solid,.fa-regular,.fa-classic):before{content:var(--fa)/""}',
  '@supports not (content:""/""){:is(.fa,.fa-solid,.fa-regular,.fa-classic):before{content:var(--fa)}}',
  '.fa-solid{--fa-style:900}',
  '.fa-regular{--fa-style:400}',
];
for (const cls of [...usedUtilities].sort()) {
  const rule = utilityRule(cls);
  if (rule) cssParts.push(rule);
  else console.warn(`ATTENTION : regle utilitaire .${cls} introuvable dans fontawesome.min.css`);
}
for (const [cls, glyph] of allIcons) cssParts.push(`.${cls}{--fa:"${esc(glyph)}"}`);

const cssOut = cssParts.join('\n') + '\n';
const cssPath = join(FA_DIR, 'css', 'fa-subset.min.css');
writeFileSync(cssPath, cssOut, 'utf8');
console.log(`fa-subset.min.css : ${Buffer.byteLength(cssOut)} o (${allIcons.size} icones, ${usedUtilities.size} utilitaires)`);
