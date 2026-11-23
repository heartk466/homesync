// Dark mode for every screen and component, generated from the app's own CSS.
//
// Most components hard-code the light palette (#fff cards, #2D1A7A text,
// #F0EDFF chips …), so instead of hand-writing a dark rule per class this
// walks every loaded stylesheet once and writes a "dark twin" of each rule
// that sets a colour:
//   light backgrounds → deep purple surfaces (pastel status colours keep their hue)
//   dark text         → light text of the same hue
//   light borders     → subtle dark borders
// Twins use `:where([data-theme="dark"]) <selector>`, so they keep the
// original selector's specificity, and they're appended after all other CSS in
// the same order — the cascade (active / selected / hover states) works out
// exactly as in light mode. Colours the app sets inline (style={{ … }}) are
// covered by attribute selectors for the palette in INLINE_PALETTE.
// global-dark.css still holds the hand-tuned overrides; its rules are skipped.

const STYLE_ID = 'hs-dark-auto';
const DARK = ':where([data-theme="dark"])';
const COLOR_TOKEN = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black)\b/gi;
const BORDER_PROPS = ['border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'outline-color'];

// Colours used in inline styles across the screens (see grep of style={{ … }})
const INLINE_PALETTE = [
  '#FFFFFF', '#F8F6FF', '#FBFAFF', '#F5F3FF', '#F3F0FF', '#F0EDFF', '#EDE9FF', '#E0D9FF', '#DDD6FE',
  '#2D1A7A', '#3B2AAB', '#5A4AAA', '#4C1D95', '#6B46C1', '#1A1A2E', '#333333', '#4A5568', '#2D3748', '#718096',
  '#FFF3CD', '#856404', '#FFFAF0', '#FEEBC8', '#C05621', '#B7791F',
  '#FFE5E5', '#FEE2E2', '#FFF0F0', '#FFF5F5', '#E53E3E', '#C53030', '#742A2A',
  '#D1FAE5', '#F0FFF4', '#065F46', '#38A169', '#E6FFFA', '#2C7A7B', '#EBF8FF', '#2B6CB0', '#9B2C87',
];

// ── colour maths ──────────────────────────────────────────────────────────
function parseColor(token) {
  const t = token.trim().toLowerCase();
  if (t === 'white') return { r: 255, g: 255, b: 255, a: 1 };
  if (t === 'black') return { r: 0, g: 0, b: 0, a: 1 };
  if (t.startsWith('#')) {
    let hex = t.slice(1);
    if (hex.length === 3 || hex.length === 4) hex = hex.split('').map((c) => c + c).join('');
    if (hex.length !== 6 && hex.length !== 8) return null;
    const n = (i) => parseInt(hex.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: hex.length === 8 ? n(6) / 255 : 1 };
  }
  const parts = t.replace(/rgba?\(|\)/g, '').split(/[\s,/]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) return null;
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 && !Number.isNaN(parts[3]) ? parts[3] : 1 };
}

function toHsl({ r, g, b }) {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return { h: h * 60, s, l };
}

const hsla = (h, s, l, a) =>
  `hsla(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(Math.min(Math.max(l, 0), 1) * 100)}%, ${a})`;

// Near-white / lavender → the app's deep purple surfaces; pastel status
// colours (yellow, red, green, blue …) → a dark tint of the same hue.
function darkBackground(c, threshold = 0.82) {
  const { h, s, l } = toHsl(c);
  if (c.a === 0 || l < threshold) return null;
  const neutral = s < 0.15 || (h >= 225 && h <= 290);
  if (neutral) return hsla(s < 0.15 ? 248 : h, 0.42, 0.16 + (1 - l) * 0.9, c.a);
  return hsla(h, Math.min(s, 0.5), 0.2 + (1 - l) * 0.5, c.a);
}

// Gradients: soft light stops (e.g. the screen's lavender fade) go dark too
function darkGradientStop(c) {
  const { h, s, l } = toHsl(c);
  if (c.a === 0 || l < 0.6) return null;
  return hsla(s < 0.15 ? 248 : h, Math.min(Math.max(s, 0.3), 0.5), 0.12 + (1 - l) * 0.5, c.a);
}

function darkText(c) {
  const { h, s, l } = toHsl(c);
  if (c.a === 0 || l > 0.55) return null;
  return hsla(h, Math.min(s, 0.85), 0.92 - l * 0.45, c.a);
}

function darkBorder(c) {
  const { h, s, l } = toHsl(c);
  if (c.a === 0 || l < 0.8) return null;
  return hsla(s < 0.15 ? 248 : h, Math.min(Math.max(s, 0.3), 0.45), 0.22 + (1 - l) * 0.9, c.a);
}

const mapTokens = (value, fn) => value.replace(COLOR_TOKEN, (tok) => {
  const c = parseColor(tok);
  return (c && fn(c)) || tok;
});

// ── stylesheet walk ───────────────────────────────────────────────────────
// Split "a, b:is(c, d)" on top-level commas only
function splitSelectors(text) {
  const out = []; let depth = 0; let cur = '';
  for (const ch of text) {
    if (ch === '(' || ch === '[') depth += 1;
    if (ch === ')' || ch === ']') depth -= 1;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const darkSelector = (sel) => {
  if (/^(:root|html)\b/.test(sel)) return sel.replace(/^(:root|html)/, `$1${DARK}`);
  return `${DARK} ${sel}`;
};

function twinOf(rule) {
  const sel = rule.selectorText;
  if (!sel || sel.includes('data-theme')) return '';
  const st = rule.style;
  const decls = [];
  const push = (prop, value) => {
    if (!value) return;
    const imp = st.getPropertyPriority(prop) ? ' !important' : '';
    decls.push(`${prop}: ${value}${imp}`);
  };

  const bg = st.getPropertyValue('background-color');
  if (bg) push('background-color', mapTokens(bg, darkBackground));
  const img = st.getPropertyValue('background-image');
  if (img && img.includes('gradient')) push('background-image', mapTokens(img, darkGradientStop));
  const color = st.getPropertyValue('color');
  if (color) push('color', mapTokens(color, darkText));
  BORDER_PROPS.forEach((p) => {
    const v = st.getPropertyValue(p);
    if (v) push(p, mapTokens(v, darkBorder));
  });

  if (!decls.length) return '';
  return `${splitSelectors(sel).map(darkSelector).join(', ')} { ${decls.join('; ')}; }`;
}

function walk(rules) {
  let css = '';
  for (const rule of rules) {
    if (rule instanceof CSSStyleRule) css += twinOf(rule) + '\n';
    else if (rule instanceof CSSMediaRule) {
      const inner = walk(rule.cssRules);
      if (inner.trim()) css += `@media ${rule.conditionText || rule.media.mediaText} {\n${inner}}\n`;
    } else if (typeof CSSSupportsRule !== 'undefined' && rule instanceof CSSSupportsRule) {
      const inner = walk(rule.cssRules);
      if (inner.trim()) css += `@supports ${rule.conditionText} {\n${inner}}\n`;
    }
  }
  return css;
}

function inlineRules() {
  let css = '';
  INLINE_PALETTE.forEach((hex) => {
    const c = parseColor(hex);
    const rgb = `rgb(${c.r}, ${c.g}, ${c.b})`;
    const names = hex === '#FFFFFF' ? [rgb, 'white'] : [rgb];
    const text = darkText(c);
    const bg = darkBackground(c);
    const border = darkBorder(c);
    names.forEach((n) => {
      if (text) css += `${DARK} [style^="color: ${n}"], ${DARK} [style*=" color: ${n}"] { color: ${text} !important; }\n`;
      if (bg) css += `${DARK} [style*="background: ${n}"], ${DARK} [style*="background-color: ${n}"] { background-color: ${bg} !important; }\n`;
      if (border) css += `${DARK} [style*="solid ${n}"], ${DARK} [style*="border-color: ${n}"] { border-color: ${border} !important; }\n`;
    });
  });
  return css;
}

/** Builds (or rebuilds) the generated dark stylesheet. Cheap enough to call on every switch. */
export function applyDarkStyles() {
  if (typeof document === 'undefined') return;
  let css = '';
  for (const sheet of Array.from(document.styleSheets)) {
    if (sheet.ownerNode?.id === STYLE_ID) continue;
    let rules;
    try { rules = sheet.cssRules; } catch { continue; } // cross-origin (Google Fonts)
    if (rules) css += walk(rules);
  }
  css += inlineRules();
  css += `html${DARK}, ${DARK} body { background: #12102b; color: #E8E0FF; color-scheme: dark; }\n`;

  let el = document.getElementById(STYLE_ID);
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ID;
  }
  el.textContent = css;
  document.head.appendChild(el); // (re)append so it stays after every other stylesheet
  watchStylesheets();
}

// Stylesheets can arrive after dark mode was switched on (a screen's CSS
// loading later, or a hot reload while developing) — rebuild the twins then,
// so new components are dark too.
let watcher = null;
let rebuildTimer = null;
function watchStylesheets() {
  if (watcher || typeof MutationObserver === 'undefined') return;
  watcher = new MutationObserver((mutations) => {
    const relevant = mutations.some((m) => {
      const target = m.target.nodeType === 1 ? m.target : m.target.parentNode;
      if (target?.id === STYLE_ID) return false;
      return [...m.addedNodes, ...m.removedNodes, target].some((n) => n && (n.nodeName === 'STYLE' || n.nodeName === 'LINK') && n.id !== STYLE_ID);
    });
    if (!relevant || document.documentElement.getAttribute('data-theme') !== 'dark') return;
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(applyDarkStyles, 150);
  });
  watcher.observe(document.head, { childList: true, subtree: true, characterData: true });
}
