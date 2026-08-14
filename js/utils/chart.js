/**
 * chart.js — Graphiques SVG vanilla (aucune dépendance externe)
 * Gros Monsieur PWA
 *
 * Génère des chaînes SVG responsives à partir de séries de points.
 * Seule dépendance : helpers.js (formatDateShort, escapeHtml).
 *
 * Règles de style :
 * - Couleurs uniquement via tokens CSS (lisible dans les deux thèmes).
 * - Le texte utilise TOUJOURS les tokens de texte, jamais la couleur de série.
 */

import { formatDateShort, escapeHtml } from './helpers.js';

// ── Constantes de mise en page (unités viewBox) ──────────────

const VB_WIDTH    = 320; // largeur logique du viewBox
const PAD_LEFT    = 38;  // place pour les labels de l'axe Y
const PAD_RIGHT   = 10;
const PAD_TOP     = 16;  // place pour le label du dernier point
const PAD_BOTTOM  = 18;  // place pour les dates de l'axe X
const MAX_MARKERS = 12;  // au-delà : ligne seule (sauf dernier point)

// ── Helpers internes ─────────────────────────────────────────

/**
 * Arrondit x à un nombre "propre" (1, 2, 5 × 10^n).
 * Algorithme classique de Heckbert (nice numbers).
 * @param {number} x     - Valeur strictement positive
 * @param {boolean} round - true : arrondi au plus proche, false : plafond
 * @returns {number}
 */
function _niceNum(x, round) {
  const exp = Math.floor(Math.log10(x));
  const f   = x / Math.pow(10, exp);
  let nf;
  if (round) {
    nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
  } else {
    nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  }
  return nf * Math.pow(10, exp);
}

/**
 * Calcule 2 à 4 valeurs de ticks "propres" dans [min, max].
 * @param {number} min
 * @param {number} max
 * @returns {number[]}
 */
function _niceTicks(min, max) {
  const range = max - min;
  if (!(range > 0)) return [min];
  const step  = _niceNum(_niceNum(range, false) / 2, true);
  const start = Math.ceil(min / step) * step;
  const ticks = [];
  for (let v = start; v <= max + step * 1e-6; v += step) {
    ticks.push(Math.round(v * 1000) / 1000);
  }
  // Fallback si l'arrondi n'a produit qu'un tick (ou aucun)
  if (ticks.length < 2) {
    return [Math.round(min * 100) / 100, Math.round(max * 100) / 100];
  }
  return ticks.slice(0, 4);
}

/**
 * Formate un nombre pour affichage (supprime le bruit flottant).
 * @param {number} v
 * @returns {string}
 */
function _fmtNum(v) {
  return String(Math.round(v * 100) / 100);
}

/**
 * Arrondit une coordonnée SVG à 1 décimale.
 * @param {number} v
 * @returns {number}
 */
function _px(v) {
  return Math.round(v * 10) / 10;
}

// ── API publique ─────────────────────────────────────────────

/**
 * Génère un graphique en ligne SVG (string) à partir d'une série de points.
 *
 * - SVG responsive : viewBox + width 100 %, hauteur logique 120-160 px.
 * - Ligne 2 px en var(--accent), aire légère en var(--accent-dim).
 * - Marqueurs (r=3) seulement si ≤ 12 points ; le dernier point a toujours
 *   un marqueur et un label direct de sa valeur.
 * - Grille horizontale discrète (var(--border)), pas de grille verticale.
 * - Axe Y : 2-3 ticks arrondis "propres" ; axe X : première et dernière date.
 *
 * Cas limites : 0 point → chaîne vide (le caller gère l'état vide),
 * 1 point → marqueur + label seuls, valeurs identiques → échelle avec padding.
 *
 * @param {{x: number, y: number}[]} points - Points triés par x (timestamp ms)
 * @param {object} [options]
 * @param {string} [options.ariaLabel]   - Label d'accessibilité du SVG
 * @param {number} [options.height]      - Hauteur logique (borné à 120-160)
 * @param {(v: number) => string} [options.formatValue] - Formateur du label
 *   de valeur (dernier point). Le résultat est échappé avant injection.
 * @returns {string} Markup SVG, ou '' si aucun point exploitable
 */
export function lineChart(points, options = {}) {
  const {
    ariaLabel   = '',
    height      = 140,
    formatValue = _fmtNum,
  } = options;

  // Sécurité : ne garder que des points numériques finis, triés par x
  const pts = (Array.isArray(points) ? points : [])
    .filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y))
    .sort((a, b) => a.x - b.x);

  if (pts.length === 0) return '';

  const H     = Math.max(120, Math.min(160, Math.round(height)));
  const plotW = VB_WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotH = H - PAD_TOP - PAD_BOTTOM;

  // ── Domaine Y (avec padding, gère les valeurs identiques) ──
  const rawMin = Math.min(...pts.map(p => p.y));
  const rawMax = Math.max(...pts.map(p => p.y));
  let yMin = rawMin;
  let yMax = rawMax;
  if (yMin === yMax) {
    const pad = Math.max(1, Math.abs(yMin) * 0.05);
    yMin -= pad;
    yMax += pad;
  } else {
    const pad = (yMax - yMin) * 0.1;
    yMin -= pad;
    yMax += pad;
  }
  // Ne pas descendre sous zéro si toutes les valeurs sont positives
  if (rawMin >= 0 && yMin < 0) yMin = 0;

  // ── Échelles ───────────────────────────────────────────────
  const xMin = pts[0].x;
  const xMax = pts[pts.length - 1].x;
  const sx = ts => xMax === xMin
    ? PAD_LEFT + plotW / 2
    : PAD_LEFT + ((ts - xMin) / (xMax - xMin)) * plotW;
  const sy = v => PAD_TOP + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  const parts = [];

  // ── Grille horizontale + ticks Y ───────────────────────────
  const ticks = _niceTicks(yMin, yMax);
  for (const tick of ticks) {
    const y = _px(sy(tick));
    parts.push(
      `<line x1="${PAD_LEFT}" y1="${y}" x2="${VB_WIDTH - PAD_RIGHT}" y2="${y}" ` +
      `stroke="var(--border)" stroke-width="1"/>`
    );
    parts.push(
      `<text x="${PAD_LEFT - 6}" y="${y}" dy="3" text-anchor="end" ` +
      `font-size="10" fill="var(--text-secondary)">${escapeHtml(_fmtNum(tick))}</text>`
    );
  }

  // ── Aire + ligne (dès 2 points) ────────────────────────────
  if (pts.length >= 2) {
    const coords   = pts.map(p => `${_px(sx(p.x))},${_px(sy(p.y))}`);
    const lineD    = `M${coords.join('L')}`;
    const baseY    = _px(PAD_TOP + plotH);
    const areaD    =
      `${lineD}L${_px(sx(xMax))},${baseY}L${_px(sx(xMin))},${baseY}Z`;

    parts.push(`<path d="${areaD}" fill="var(--accent-dim)" stroke="none"/>`);
    parts.push(
      `<path d="${lineD}" fill="none" stroke="var(--accent)" stroke-width="2" ` +
      `stroke-linecap="round" stroke-linejoin="round"/>`
    );
  }

  // ── Marqueurs ──────────────────────────────────────────────
  const showAllMarkers = pts.length <= MAX_MARKERS;
  pts.forEach((p, i) => {
    const isLast = i === pts.length - 1;
    if (!showAllMarkers && !isLast) return;
    parts.push(
      `<circle cx="${_px(sx(p.x))}" cy="${_px(sy(p.y))}" r="3" fill="var(--accent)"/>`
    );
  });

  // ── Label direct de la valeur du dernier point ─────────────
  const last   = pts[pts.length - 1];
  const lastX  = _px(sx(last.x));
  const lastY  = _px(sy(last.y));
  const anchor = lastX > VB_WIDTH * 0.72 ? 'end' : 'middle';
  // Au-dessus du point, ou en dessous s'il touche le bord haut
  const labelY = lastY - 8 < 10 ? lastY + 16 : lastY - 8;
  parts.push(
    `<text x="${lastX}" y="${_px(labelY)}" text-anchor="${anchor}" ` +
    `font-size="10" font-weight="600" fill="var(--text)">` +
    `${escapeHtml(formatValue(last.y))}</text>`
  );

  // ── Axe X : première et dernière date ──────────────────────
  const dateY = H - 4;
  if (pts.length >= 2) {
    parts.push(
      `<text x="${PAD_LEFT}" y="${dateY}" text-anchor="start" ` +
      `font-size="10" fill="var(--text-secondary)">${escapeHtml(formatDateShort(xMin))}</text>`
    );
    parts.push(
      `<text x="${VB_WIDTH - PAD_RIGHT}" y="${dateY}" text-anchor="end" ` +
      `font-size="10" fill="var(--text-secondary)">${escapeHtml(formatDateShort(xMax))}</text>`
    );
  } else {
    parts.push(
      `<text x="${_px(PAD_LEFT + plotW / 2)}" y="${dateY}" text-anchor="middle" ` +
      `font-size="10" fill="var(--text-secondary)">${escapeHtml(formatDateShort(xMin))}</text>`
    );
  }

  return (
    `<svg viewBox="0 0 ${VB_WIDTH} ${H}" role="img" ` +
    `aria-label="${escapeHtml(ariaLabel)}" ` +
    `style="display:block;width:100%;height:auto;">${parts.join('')}</svg>`
  );
}
