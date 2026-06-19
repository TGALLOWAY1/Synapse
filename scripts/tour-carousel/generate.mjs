// Generates LinkedIn-carousel PNG slides for the Synapse interactive tour.
// Mirrors the live /tour dark theme and uses the real tour copy + demo data.
// Run: node scripts/tour-carousel/generate.mjs
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'linkedin-tour');
mkdirSync(OUT, { recursive: true });

const W = 1080;
const H = 1350;
const PAD = 88;

// ── palette (matches the tour's neutral-900 / indigo theme) ──────────────
const C = {
  text: '#f5f5f5',
  sub: '#a3a3a3',
  faint: '#737373',
  card: '#1d1d27',
  cardBorder: '#33333f',
  indigo: '#4f46e5',
  indigo300: '#a5b4fc',
  indigo400: '#818cf8',
  violet400: '#a78bfa',
  green: '#34d399',
  amber: '#fbbf24',
  red: '#fb7185',
  sky: '#7dd3fc',
  orange: '#fdba74',
  pink: '#f9a8d4',
  teal: '#5eead4',
};

const FONT = 'Liberation Sans, DejaVu Sans, Arial, sans-serif';
const MONO = 'Liberation Mono, DejaVu Sans Mono, monospace';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// approx text width for Liberation Sans
function textWidth(str, size, weight = 400) {
  const factor = weight >= 600 ? 0.56 : 0.52;
  return str.length * size * factor;
}
function wrap(str, size, maxW, weight = 400) {
  const words = str.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (textWidth(test, size, weight) > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

// tokenized headline wrap (white title + gradient accent)
function headlineLines(tokens, size, maxW) {
  const words = [];
  for (const t of tokens) for (const w of t.text.split(' ')) words.push({ w, grad: t.grad });
  const lines = [];
  let cur = [];
  const curStr = () => cur.map((x) => x.w).join(' ');
  for (const word of words) {
    const test = cur.length ? curStr() + ' ' + word.w : word.w;
    if (textWidth(test, size, 700) > maxW && cur.length) {
      lines.push(cur);
      cur = [word];
    } else cur.push(word);
  }
  if (cur.length) lines.push(cur);
  return lines;
}

function rrect(x, y, w, h, r, fill, stroke, sw = 1) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="${fill}"${
    stroke ? ` stroke="${stroke}" stroke-width="${sw}"` : ''
  }/>`;
}
function tspanLine(line, x, y, size) {
  const spans = line
    .map(
      (wd) =>
        `<tspan fill="${wd.grad ? 'url(#grad)' : C.text}">${esc(wd.w)}</tspan>`,
    )
    .join('<tspan> </tspan>');
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="700" letter-spacing="-0.5">${spans}</text>`;
}

// ── chrome (header + footer) shared by every slide ───────────────────────
function header(stepLabel, idx) {
  const logo = `
    <rect x="${PAD}" y="78" width="60" height="60" rx="16" fill="${C.indigo}"/>
    <text x="${PAD + 30}" y="120" font-family="${FONT}" font-size="34" font-weight="700" fill="#fff" text-anchor="middle">S</text>
    <text x="${PAD + 76}" y="103" font-family="${FONT}" font-size="27" font-weight="700" fill="${C.text}">Synapse</text>
    <text x="${PAD + 76}" y="130" font-family="${FONT}" font-size="16" fill="${C.faint}">From plain-language to product blueprint</text>`;
  let badge = '';
  if (stepLabel) {
    const bw = textWidth(stepLabel, 17, 600) + 44;
    badge = `${rrect(W - PAD - bw, 84, bw, 44, 22, 'rgba(79,70,229,0.12)', 'rgba(129,140,248,0.4)', 1)}
      <text x="${W - PAD - bw / 2}" y="112" font-family="${FONT}" font-size="17" font-weight="600" fill="${C.indigo300}" text-anchor="middle" letter-spacing="1">${esc(stepLabel)}</text>`;
  }
  return logo + badge;
}
function footer(pageNo, total, showSwipe) {
  const y = H - 66;
  const left = `<text x="${PAD}" y="${y}" font-family="${FONT}" font-size="19" font-weight="600" fill="${C.faint}">synapse<tspan fill="${C.indigo400}">  ·  take the interactive tour at /tour</tspan></text>`;
  let right = `<text x="${W - PAD}" y="${y}" font-family="${FONT}" font-size="19" font-weight="700" fill="${C.faint}" text-anchor="end">${String(pageNo).padStart(2, '0')} / ${String(total).padStart(2, '0')}</text>`;
  if (showSwipe) {
    right = `<text x="${W - PAD}" y="${y}" font-family="${FONT}" font-size="19" font-weight="600" fill="${C.indigo300}" text-anchor="end">Swipe  →</text>`;
  }
  return left + right;
}

// headline block, returns {svg, bottomY}
function headlineBlock(tokens, sub, startY = 250) {
  const size = 66;
  const lh = 76;
  const maxW = W - PAD * 2;
  const lines = headlineLines(tokens, size, maxW);
  let y = startY;
  let svg = '';
  for (const ln of lines) {
    svg += tspanLine(ln, PAD, y, size);
    y += lh;
  }
  if (sub) {
    y += 6;
    const subLines = wrap(sub, 28, W - PAD * 2 - 40, 400);
    for (const sl of subLines) {
      svg += `<text x="${PAD}" y="${y}" font-family="${FONT}" font-size="28" fill="${C.sub}">${esc(sl)}</text>`;
      y += 40;
    }
  }
  return { svg, bottomY: y };
}

function frame(inner, { step, page, total, swipe } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="grad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${C.indigo400}"/>
      <stop offset="1" stop-color="${C.violet400}"/>
    </linearGradient>
    <linearGradient id="bg" x1="0" y1="0" x2="0.6" y2="1">
      <stop offset="0" stop-color="#1a1a24"/>
      <stop offset="1" stop-color="#121217"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.85" cy="0.08" r="0.5">
      <stop offset="0" stop-color="rgba(99,82,241,0.28)"/>
      <stop offset="1" stop-color="rgba(99,82,241,0)"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  ${header(step, page)}
  ${inner}
  ${footer(page, total, swipe)}
</svg>`;
}

function render(name, svg) {
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: W },
    font: { loadSystemFonts: true, defaultFontFamily: 'Liberation Sans' },
  });
  const png = r.render().asPng();
  writeFileSync(join(OUT, name), png);
  console.log('wrote', name, (png.length / 1024).toFixed(0) + 'KB');
}

// ── simple line-icon set for asset tiles ─────────────────────────────────
function icon(kind, x, y, s, color) {
  const sw = 2.4;
  const g = (p) => `<g transform="translate(${x},${y})" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${p}</g>`;
  switch (kind) {
    case 'flow':
      return g(`<rect x="2" y="3" width="8" height="7" rx="2"/><rect x="${s - 10}" y="3" width="8" height="7" rx="2"/><rect x="${s / 2 - 4}" y="${s - 10}" width="8" height="7" rx="2"/><path d="M6 10 V14 H${s / 2} V${s - 10}"/><path d="M${s - 6} 10 V14 H${s / 2}"/>`);
    case 'screens':
      return g(`<rect x="${s / 2 - 8}" y="2" width="16" height="${s - 4}" rx="3"/><line x1="${s / 2 - 3}" y1="${s - 5}" x2="${s / 2 + 3}" y2="${s - 5}"/>`);
    case 'table':
      return g(`<ellipse cx="${s / 2}" cy="5" rx="9" ry="3.5"/><path d="M${s / 2 - 9} 5 V${s - 5} a9 3.5 0 0 0 18 0 V5"/><path d="M${s / 2 - 9} ${s / 2} a9 3.5 0 0 0 18 0"/>`);
    case 'grid':
      return g(`<rect x="2" y="2" width="7" height="7" rx="1.5"/><rect x="${s - 9}" y="2" width="7" height="7" rx="1.5"/><rect x="2" y="${s - 9}" width="7" height="7" rx="1.5"/><rect x="${s - 9}" y="${s - 9}" width="7" height="7" rx="1.5"/>`);
    case 'roadmap':
      return g(`<polyline points="3,7 7,11 13,4"/><polyline points="3,${s - 5} 7,${s - 1} 13,${s - 8}"/><line x1="16" y1="6" x2="${s - 2}" y2="6"/><line x1="16" y1="${s - 4}" x2="${s - 2}" y2="${s - 4}"/>`);
    case 'palette':
      return g(`<circle cx="${s / 2}" cy="${s / 2}" r="${s / 2 - 2}"/><circle cx="${s / 2 - 4}" cy="${s / 2 - 3}" r="1.6" fill="${color}"/><circle cx="${s / 2 + 4}" cy="${s / 2 - 3}" r="1.6" fill="${color}"/><circle cx="${s / 2}" cy="${s / 2 + 4}" r="1.6" fill="${color}"/>`);
    case 'prompt':
      return g(`<path d="M3 4 h${s - 6} a2 2 0 0 1 2 2 v${s - 12} a2 2 0 0 1 -2 2 h-${s - 14} l-5 5 v-5 h-1 a2 2 0 0 1 -2 -2 v-${s - 12} a2 2 0 0 1 2 -2 z"/>`);
    default:
      return '';
  }
}

// ═══════════════════════ SLIDE 0 — COVER ════════════════════════════════
{
  let s = '';
  const cy = 470;
  s += `<text x="${PAD}" y="300" font-family="${FONT}" font-size="22" font-weight="700" fill="${C.indigo300}" letter-spacing="3">AN INTERACTIVE PRODUCT TOUR</text>`;
  const big = headlineLines([{ text: 'Turn a sentence into a', grad: false }, { text: 'product blueprint.', grad: true }], 82, W - PAD * 2);
  let y = 420;
  for (const ln of big) {
    s += tspanLine(ln, PAD, y, 82);
    y += 92;
  }
  y += 12;
  for (const sl of wrap('Synapse takes a plain-language idea and builds a structured PRD, mockups, a data model, and everything else you need to build — in six steps.', 30, W - PAD * 2 - 20)) {
    s += `<text x="${PAD}" y="${y}" font-family="${FONT}" font-size="30" fill="${C.sub}">${esc(sl)}</text>`;
    y += 44;
  }
  // idea -> blueprint mini visual
  const by = y + 50;
  s += rrect(PAD, by, W - PAD * 2, 150, 22, C.card, C.cardBorder);
  s += `<text x="${PAD + 36}" y="${by + 44}" font-family="${FONT}" font-size="18" font-weight="600" fill="${C.faint}" letter-spacing="1">YOUR IDEA</text>`;
  s += `<text x="${PAD + 36}" y="${by + 92}" font-family="${FONT}" font-size="28" fill="${C.text}">“Build an app that helps musicians finish songs.”</text>`;
  s += `<text x="${PAD + 36}" y="${by + 128}" font-family="${FONT}" font-size="20" fill="${C.indigo300}">↓  a full product spec, versioned and connected</text>`;
  // beat chips
  const beats = ['Idea', 'Spec', 'Refine', 'Versions', 'Assets', 'Connected'];
  let bx = PAD;
  const chy = by + 196;
  for (let i = 0; i < beats.length; i++) {
    const lbl = `${i + 1}. ${beats[i]}`;
    const cw = textWidth(lbl, 19, 600) + 34;
    if (bx + cw > W - PAD) break;
    s += rrect(bx, chy, cw, 46, 23, 'rgba(255,255,255,0.04)', C.cardBorder);
    s += `<text x="${bx + cw / 2}" y="${chy + 30}" font-family="${FONT}" font-size="19" font-weight="600" fill="${C.sub}" text-anchor="middle">${esc(lbl)}</text>`;
    bx += cw + 12;
  }
  render('00-cover.png', frame(s, { page: 0, total: 7, swipe: true }));
}

// ═══════════════════════ SLIDE 1 — IDEA ═════════════════════════════════
{
  let s = '';
  const hb = headlineBlock(
    [{ text: 'Start with', grad: false }, { text: 'a single idea.', grad: true }],
    'Synapse transforms a plain-language concept into a structured product blueprint.',
  );
  s += hb.svg;
  let y = hb.bottomY + 36;
  // idea card
  s += rrect(PAD, y, W - PAD * 2, 132, 20, C.card, C.cardBorder);
  s += `<text x="${PAD + 32}" y="${y + 40}" font-family="${FONT}" font-size="17" font-weight="600" fill="${C.faint}" letter-spacing="1">YOUR IDEA</text>`;
  s += `<text x="${PAD + 32}" y="${y + 86}" font-family="${FONT}" font-size="29" fill="${C.text}">“Build an app that helps musicians finish songs.”</text>`;
  s += `<text x="${W - PAD - 24}" y="${y + 86}" font-family="${FONT}" font-size="26" fill="${C.indigo300}" text-anchor="end">▶</text>`;
  y += 132 + 30;
  s += `<text x="${W / 2}" y="${y}" font-family="${FONT}" font-size="24" fill="${C.faint}" text-anchor="middle">generates a structured PRD ↓</text>`;
  y += 28;
  // 4 section cards (2x2)
  const sections = [
    ['1. Product Vision', C.indigo400],
    ['2. Target Users', C.sky],
    ['3. Core Problems', C.amber],
    ['4. Key Features', C.green],
  ];
  const gap = 24;
  const cw = (W - PAD * 2 - gap) / 2;
  const ch = 150;
  for (let i = 0; i < 4; i++) {
    const cx = PAD + (i % 2) * (cw + gap);
    const cyy = y + Math.floor(i / 2) * (ch + gap);
    s += rrect(cx, cyy, cw, ch, 18, C.card, C.cardBorder);
    s += `<rect x="${cx}" y="${cyy + 22}" width="5" height="30" rx="2.5" fill="${sections[i][1]}"/>`;
    s += `<text x="${cx + 28}" y="${cyy + 46}" font-family="${FONT}" font-size="25" font-weight="700" fill="${C.text}">${esc(sections[i][0])}</text>`;
    for (let l = 0; l < 3; l++) {
      const lw = cw - 56 - (l === 2 ? 80 : 0);
      s += rrect(cx + 28, cyy + 74 + l * 22, lw, 9, 4.5, 'rgba(255,255,255,0.08)');
    }
  }
  render('01-idea.png', frame(s, { step: 'STEP 1 · IDEA', page: 1, total: 7, swipe: true }));
}

// ═══════════════════════ SLIDE 2 — GENERATION ═══════════════════════════
{
  let s = '';
  const hb = headlineBlock(
    [{ text: 'AI builds the spec', grad: false }, { text: 'section by section.', grad: true }],
    'Every section is generated independently — and many run concurrently — so you see exactly what is happening.',
  );
  s += hb.svg;
  let y = hb.bottomY + 30;
  const steps = [
    ['Product Thesis', false],
    ['Users & Personas', false],
    ['Core Problems', false],
    ['Solutions & Features', true],
    ['Architecture', false],
    ['Metrics', false],
    ['Risks', false],
    ['Goals & Outcomes', false],
  ];
  const rh = 78;
  const rgap = 14;
  for (let i = 0; i < steps.length; i++) {
    const cyy = y + i * (rh + rgap);
    const concurrent = steps[i][1];
    s += rrect(PAD, cyy, W - PAD * 2, rh, 16, C.card, concurrent ? 'rgba(129,140,248,0.5)' : C.cardBorder, concurrent ? 2 : 1);
    // check circle
    s += `<circle cx="${PAD + 38}" cy="${cyy + rh / 2}" r="17" fill="rgba(52,211,153,0.15)" stroke="${C.green}" stroke-width="2"/>`;
    s += `<path d="M${PAD + 30} ${cyy + rh / 2} l5 5 l9 -10" fill="none" stroke="${C.green}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`;
    s += `<text x="${PAD + 74}" y="${cyy + rh / 2 + 9}" font-family="${FONT}" font-size="26" font-weight="600" fill="${C.text}">${esc(steps[i][0])}</text>`;
    if (concurrent) {
      const lbl = 'Running concurrently';
      const bw = textWidth(lbl, 17, 600) + 32;
      s += rrect(W - PAD - bw - 20, cyy + rh / 2 - 18, bw, 36, 18, 'rgba(129,140,248,0.12)', 'rgba(129,140,248,0.4)');
      s += `<text x="${W - PAD - bw / 2 - 20}" y="${cyy + rh / 2 + 6}" font-family="${FONT}" font-size="17" font-weight="600" fill="${C.indigo300}" text-anchor="middle">${esc(lbl)}</text>`;
    } else {
      s += `<text x="${W - PAD - 24}" y="${cyy + rh / 2 + 7}" font-family="${FONT}" font-size="20" fill="${C.green}" text-anchor="end">Done</text>`;
    }
  }
  render('02-generation.png', frame(s, { step: 'STEP 2 · GENERATION', page: 2, total: 7, swipe: true }));
}

// ═══════════════════════ SLIDE 3 — REFINE ═══════════════════════════════
{
  let s = '';
  const hb = headlineBlock(
    [{ text: 'Refine specific', grad: false }, { text: 'parts of the document.', grad: true }],
    'Highlight any section and improve it — without rewriting everything.',
  );
  s += hb.svg;
  let y = hb.bottomY + 34;
  // doc card with highlighted span
  s += rrect(PAD, y, W - PAD * 2, 188, 20, C.card, C.cardBorder);
  s += `<text x="${PAD + 32}" y="${y + 44}" font-family="${FONT}" font-size="22" font-weight="700" fill="${C.text}">3. Target Audience</text>`;
  // highlighted (selected) span — two lines
  const hlLines = wrap('Independent musicians, producers, and songwriters who want to finish more songs.', 24, W - PAD * 2 - 110);
  const hlH = 38 + hlLines.length * 36;
  s += rrect(PAD + 28, y + 64, W - PAD * 2 - 56, hlH, 12, 'rgba(129,140,248,0.16)', 'rgba(129,140,248,0.5)');
  let hy = y + 64 + 44;
  for (const sl of hlLines) {
    s += `<text x="${PAD + 50}" y="${hy}" font-family="${FONT}" font-size="24" fill="${C.indigo300}">${esc(sl)}</text>`;
    hy += 36;
  }
  y += 188;
  // action menu
  const actions = ['Clarify', 'Expand', 'Specify', 'Alternative', 'Replace'];
  const ay = y + 26;
  let ax = PAD;
  for (let i = 0; i < actions.length; i++) {
    const on = actions[i] === 'Specify';
    const lw = textWidth(actions[i], 22, 600) + 40;
    s += rrect(ax, ay, lw, 56, 12, on ? 'rgba(79,70,229,0.9)' : C.card, on ? C.indigo : C.cardBorder, on ? 0 : 1);
    s += `<text x="${ax + lw / 2}" y="${ay + 37}" font-family="${FONT}" font-size="22" font-weight="600" fill="${on ? '#fff' : C.sub}" text-anchor="middle">${esc(actions[i])}</text>`;
    ax += lw + 14;
  }
  y = ay + 56 + 34;
  // before -> after (Specify)
  s += `<text x="${PAD}" y="${y}" font-family="${FONT}" font-size="20" font-weight="700" fill="${C.faint}" letter-spacing="1">SPECIFY  →  RESULT</text>`;
  y += 22;
  s += rrect(PAD, y, W - PAD * 2, 168, 18, 'rgba(52,211,153,0.07)', 'rgba(52,211,153,0.35)');
  s += `<rect x="${PAD}" y="${y}" width="6" height="168" rx="3" fill="${C.green}"/>`;
  let ty = y + 50;
  for (const sl of wrap('Primarily mobile-first bedroom producers aged 18–34 on iOS who write 5+ song ideas a month but finish fewer than one.', 27, W - PAD * 2 - 70)) {
    s += `<text x="${PAD + 34}" y="${ty}" font-family="${FONT}" font-size="27" fill="${C.text}">${esc(sl)}</text>`;
    ty += 38;
  }
  render('03-refine.png', frame(s, { step: 'STEP 3 · REFINE', page: 3, total: 7, swipe: true }));
}

// ═══════════════════════ SLIDE 4 — VERSIONS ═════════════════════════════
{
  let s = '';
  const hb = headlineBlock(
    [{ text: 'Nothing gets lost.', grad: false }, { text: 'Every change is versioned.', grad: true }],
    'Every refinement becomes a new version you can revisit, compare, or build on.',
  );
  s += hb.svg;
  let y = hb.bottomY + 34;
  const versions = [
    ['v4', 'Consolidated Strategy', 'Today, 10:42 AM', 18, 7, 3],
    ['v3', 'New Monetization Strategy', 'Yesterday, 4:28 PM', 12, 5, 2],
    ['v2', 'Expanded User Personas', 'May 14, 2:11 PM', 20, 9, 1],
    ['v1', 'Initial Version', 'May 12, 11:03 AM', 0, 0, 0],
  ];
  const lineX = PAD + 26;
  const rh = 118;
  for (let i = 0; i < versions.length; i++) {
    const [id, title, date, a, c, r] = versions[i];
    const cyy = y + i * rh;
    // timeline rail
    if (i < versions.length - 1) s += `<line x1="${lineX}" y1="${cyy + 30}" x2="${lineX}" y2="${cyy + rh + 8}" stroke="${C.cardBorder}" stroke-width="2"/>`;
    const top = i === 0;
    s += `<circle cx="${lineX}" cy="${cyy + 30}" r="13" fill="${top ? C.indigo : C.card}" stroke="${top ? C.indigo : C.cardBorder}" stroke-width="2"/>`;
    s += `<text x="${lineX}" y="${cyy + 36}" font-family="${FONT}" font-size="14" font-weight="700" fill="${top ? '#fff' : C.faint}" text-anchor="middle">${esc(id)}</text>`;
    const bx = lineX + 38;
    s += rrect(bx, cyy, W - PAD - bx, 100, 16, top ? 'rgba(79,70,229,0.08)' : C.card, top ? 'rgba(129,140,248,0.4)' : C.cardBorder);
    s += `<text x="${bx + 26}" y="${cyy + 42}" font-family="${FONT}" font-size="25" font-weight="700" fill="${C.text}">${esc(title)}</text>`;
    s += `<text x="${bx + 26}" y="${cyy + 76}" font-family="${FONT}" font-size="19" fill="${C.faint}">${esc(date)}</text>`;
    if (a || c || r) {
      const stat = `<tspan fill="${C.green}">+${a}</tspan>  <tspan fill="${C.amber}">~${c}</tspan>  <tspan fill="${C.red}">−${r}</tspan>`;
      s += `<text x="${W - PAD - 24}" y="${cyy + 60}" font-family="${MONO}" font-size="24" font-weight="700" text-anchor="end">${stat}</text>`;
    } else {
      s += `<text x="${W - PAD - 24}" y="${cyy + 60}" font-family="${FONT}" font-size="19" fill="${C.faint}" text-anchor="end">first PRD</text>`;
    }
  }
  render('04-versions.png', frame(s, { step: 'STEP 4 · VERSIONS', page: 4, total: 7, swipe: true }));
}

// ═══════════════════════ SLIDE 5 — ASSETS ═══════════════════════════════
{
  let s = '';
  const hb = headlineBlock(
    [{ text: 'One finalized PRD', grad: false }, { text: 'powers the whole workspace.', grad: true }],
    'Mark your PRD as final and Synapse generates every asset you need to build.',
  );
  s += hb.svg;
  let y = hb.bottomY + 30;
  const assets = [
    ['flow', 'User Flows', 'Flow diagrams & journeys', C.sky],
    ['screens', 'UI Mockups', 'Screens & wireframes', C.indigo400],
    ['table', 'Data Model', 'Entities & relationships', C.green],
    ['grid', 'Component Library', 'Reusable UI components', C.orange],
    ['roadmap', 'Implementation Plan', 'Tech stack & architecture', C.amber],
    ['palette', 'Design System', 'Colors, type & components', C.pink],
    ['prompt', 'Prompt Pack', 'Prompts for future updates', C.teal],
  ];
  const gap = 22;
  const cols = 2;
  const cw = (W - PAD * 2 - gap) / cols;
  const ch = 132;
  for (let i = 0; i < assets.length; i++) {
    const [k, name, tag, col] = assets[i];
    const last = i === assets.length - 1;
    const cx = last ? PAD : PAD + (i % 2) * (cw + gap);
    const cyy = y + Math.floor(i / 2) * (ch + gap);
    const wfull = last ? W - PAD * 2 : cw;
    s += rrect(cx, cyy, wfull, ch, 18, C.card, C.cardBorder);
    // icon tile
    s += rrect(cx + 26, cyy + 28, 62, 62, 16, `${col}22`);
    s += icon(k, cx + 26 + 17, cyy + 28 + 17, 28, col);
    s += `<text x="${cx + 108}" y="${cyy + 56}" font-family="${FONT}" font-size="25" font-weight="700" fill="${C.text}">${esc(name)}</text>`;
    s += `<text x="${cx + 108}" y="${cyy + 88}" font-family="${FONT}" font-size="19" fill="${C.faint}">${esc(tag)}</text>`;
  }
  render('05-assets.png', frame(s, { step: 'STEP 5 · ASSETS', page: 5, total: 7, swipe: true }));
}

// ═══════════════════════ SLIDE 6 — CONNECTIONS ══════════════════════════
{
  let s = '';
  const hb = headlineBlock(
    [{ text: 'Everything', grad: false }, { text: 'stays connected.', grad: true }],
    'When the product changes, Synapse keeps the rest of the project aligned.',
  );
  s += hb.svg;
  let y = hb.bottomY + 30;
  // node graph: PRD center-left -> assets right
  const gh = 320;
  s += rrect(PAD, y, W - PAD * 2, gh, 20, C.card, C.cardBorder);
  const prdX = PAD + 60;
  const prdY = y + gh / 2;
  const nodes = [
    ['User Flows', C.sky],
    ['UI Mockups', C.indigo400],
    ['Data Model', C.green],
    ['Components', C.orange],
    ['Impl. Plan', C.amber],
  ];
  const rx = W - PAD - 230;
  const spread = gh - 90;
  for (let i = 0; i < nodes.length; i++) {
    const ny = y + 56 + (spread / (nodes.length - 1)) * i;
    s += `<path d="M${prdX + 130} ${prdY} C ${prdX + 250} ${prdY}, ${rx - 60} ${ny}, ${rx} ${ny}" fill="none" stroke="${nodes[i][1]}" stroke-width="2.5" opacity="0.55"/>`;
  }
  for (let i = 0; i < nodes.length; i++) {
    const ny = y + 56 + (spread / (nodes.length - 1)) * i;
    const nw = 210;
    s += rrect(rx, ny - 26, nw, 52, 14, '#23232f', C.cardBorder);
    s += `<circle cx="${rx + 26}" cy="${ny}" r="7" fill="${nodes[i][1]}"/>`;
    s += `<text x="${rx + 46}" y="${ny + 8}" font-family="${FONT}" font-size="21" font-weight="600" fill="${C.text}">${esc(nodes[i][0])}</text>`;
  }
  // PRD node
  s += rrect(prdX, prdY - 70, 130, 140, 18, C.indigo, '');
  s += `<text x="${prdX + 65}" y="${prdY - 22}" font-family="${FONT}" font-size="24" font-weight="700" fill="#fff" text-anchor="middle">PRD</text>`;
  s += `<text x="${prdX + 65}" y="${prdY + 12}" font-family="${FONT}" font-size="40" font-weight="700" fill="#fff" text-anchor="middle">v4</text>`;
  s += `<text x="${prdX + 65}" y="${prdY + 48}" font-family="${FONT}" font-size="16" fill="rgba(255,255,255,0.8)" text-anchor="middle">Melody Studio</text>`;
  y += gh + 36;
  // recent activity highlight
  s += `<text x="${PAD}" y="${y}" font-family="${FONT}" font-size="20" font-weight="700" fill="${C.faint}" letter-spacing="1">RECENT ACTIVITY</text>`;
  y += 24;
  const acts = [
    ['v4', 'Consolidated Strategy', '7 artifacts updated', '2h ago'],
    ['v3', 'New Monetization Strategy', '5 artifacts updated', 'Yesterday'],
  ];
  for (let i = 0; i < acts.length; i++) {
    const [id, title, impact, when] = acts[i];
    const cyy = y + i * 92;
    s += rrect(PAD, cyy, W - PAD * 2, 78, 16, C.card, C.cardBorder);
    s += rrect(PAD + 22, cyy + 23, 52, 32, 8, 'rgba(129,140,248,0.14)', 'rgba(129,140,248,0.4)');
    s += `<text x="${PAD + 48}" y="${cyy + 45}" font-family="${FONT}" font-size="19" font-weight="700" fill="${C.indigo300}" text-anchor="middle">${esc(id)}</text>`;
    s += `<text x="${PAD + 92}" y="${cyy + 38}" font-family="${FONT}" font-size="23" font-weight="600" fill="${C.text}">${esc(title)}</text>`;
    s += `<text x="${PAD + 92}" y="${cyy + 62}" font-family="${FONT}" font-size="18" fill="${C.faint}">${esc(when)}</text>`;
    const iw = textWidth(impact, 18, 600) + 28;
    s += rrect(W - PAD - iw - 20, cyy + 24, iw, 30, 15, 'rgba(52,211,153,0.12)', 'rgba(52,211,153,0.4)');
    s += `<text x="${W - PAD - iw / 2 - 20}" y="${cyy + 44}" font-family="${FONT}" font-size="18" font-weight="600" fill="${C.green}" text-anchor="middle">${esc(impact)}</text>`;
  }
  render('06-connections.png', frame(s, { step: 'STEP 6 · CONNECTED', page: 6, total: 7, swipe: true }));
}

// ═══════════════════════ SLIDE 7 — CLOSING CTA ══════════════════════════
{
  let s = '';
  s += `<text x="${PAD}" y="300" font-family="${FONT}" font-size="22" font-weight="700" fill="${C.indigo300}" letter-spacing="3">FROM IDEA TO BUILD-READY</text>`;
  const big = headlineLines([{ text: 'Try the', grad: false }, { text: 'interactive tour', grad: true }, { text: 'yourself.', grad: false }], 76, W - PAD * 2);
  let y = 410;
  for (const ln of big) {
    s += tspanLine(ln, PAD, y, 76);
    y += 88;
  }
  y += 18;
  for (const sl of wrap('Six steps that take a one-line idea to a versioned PRD, mockups, a data model, and a connected, build-ready workspace.', 30, W - PAD * 2 - 20)) {
    s += `<text x="${PAD}" y="${y}" font-family="${FONT}" font-size="30" fill="${C.sub}">${esc(sl)}</text>`;
    y += 44;
  }
  // recap list
  y += 36;
  const recap = [
    ['1', 'Start with a single idea'],
    ['2', 'AI builds the spec section by section'],
    ['3', 'Refine specific parts of the document'],
    ['4', 'Nothing gets lost — every change is versioned'],
    ['5', 'One finalized PRD powers the whole workspace'],
    ['6', 'Everything stays connected'],
  ];
  for (let i = 0; i < recap.length; i++) {
    const cyy = y + i * 70;
    s += `<circle cx="${PAD + 24}" cy="${cyy + 18}" r="20" fill="rgba(79,70,229,0.15)" stroke="${C.indigo}" stroke-width="2"/>`;
    s += `<text x="${PAD + 24}" y="${cyy + 26}" font-family="${FONT}" font-size="22" font-weight="700" fill="${C.indigo300}" text-anchor="middle">${esc(recap[i][0])}</text>`;
    s += `<text x="${PAD + 64}" y="${cyy + 27}" font-family="${FONT}" font-size="28" font-weight="600" fill="${C.text}">${esc(recap[i][1])}</text>`;
  }
  y += recap.length * 70 + 30;
  // CTA pill
  const cta = 'Take the tour  →  /tour';
  const cw = textWidth(cta, 28, 700) + 80;
  s += rrect(PAD, y, cw, 76, 38, C.indigo, '');
  s += `<text x="${PAD + cw / 2}" y="${y + 49}" font-family="${FONT}" font-size="28" font-weight="700" fill="#fff" text-anchor="middle">${esc(cta)}</text>`;
  render('07-cta.png', frame(s, { page: 7, total: 7 }));
}

console.log('\nAll slides written to', OUT);
