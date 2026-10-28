#!/usr/bin/env node
// Draws assets/id-card-dark.svg and assets/id-card-light.svg from live GitHub data.
// Run it locally with `node scripts/build-id-card.mjs`. The workflow in
// .github/workflows/id-card.yml reruns it every day with GITHUB_TOKEN set.

import { mkdir, writeFile } from 'node:fs/promises';

const CARD = {
  login: 'AliAljawad',
  surname: 'Aljawad',
  givenNames: 'Ali',
  role: 'Full Stack Engineer',
  employer: 'Devancy',
  stack: 'Next.js · TypeScript',
  signature: 'Ali Aljawad',
  issuer: 'Republic of Open Source',
  title: 'Developer Identity Card',
  // Short form of the stack for the code lines at the bottom of the card.
  stackCode: 'NextJS TS',
  // Part of the 400x400 avatar shown in the photo frame, in source pixels.
  photoCrop: { centerX: 185, top: 0, width: 260 },
};

const THEMES = {
  dark: {
    bg: ['#0C1424', '#111C33'],
    glow: '#38BDF8',
    glowOpacity: 0.12,
    ink: '#E7EEF8',
    muted: '#8291A8',
    accent: '#7DD3FC',
    hair: 'rgba(148,163,184,.18)',
    pattern: '#6B8BB8',
    patternOpacity: 0.13,
    waveOpacity: 0.2,
    mrzPanel: 'rgba(2,6,23,.35)',
    mrzInk: '#A9B6CA',
    sig: '#8DB8FF',
    border: 'rgba(255,255,255,.09)',
    shadowOpacity: 0.45,
    sheenOpacity: 0.1,
    // Ghost photo: luminance becomes alpha, so only the bright parts of the photo show.
    ghost: '0 0 0 0 .80  0 0 0 0 .88  0 0 0 0 1  .45 .75 .15 0 -.42',
    ghostOpacity: 0.4,
  },
  light: {
    bg: ['#F8F5EE', '#E8EFF4'],
    glow: '#0EA5E9',
    glowOpacity: 0.1,
    ink: '#0F1B2D',
    muted: '#5A687C',
    accent: '#0369A1',
    hair: 'rgba(15,27,45,.14)',
    pattern: '#6F95B5',
    patternOpacity: 0.17,
    waveOpacity: 0.28,
    mrzPanel: 'rgba(255,255,255,.55)',
    mrzInk: '#334155',
    sig: '#1D3F94',
    border: 'rgba(15,27,45,.12)',
    shadowOpacity: 0.16,
    sheenOpacity: 0.55,
    ghost: '0 0 0 0 .12  0 0 0 0 .20  0 0 0 0 .32  .45 .75 .15 0 -.42',
    ghostOpacity: 0.24,
  },
};

const TOKEN = process.env.GITHUB_TOKEN;
// Google Fonts only serves woff2 to browsers it recognizes.
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
// Printable ASCII plus the few extra characters the card uses, so fonts can be subset.
const GLYPHS = String.fromCharCode(...Array.from({ length: 95 }, (_, i) => 32 + i)) + '·—’';

async function main() {
  const profile = await fetchProfile(CARD.login);
  const [avatar, ...fonts] = await Promise.all([
    dataUri(profile.avatarUrl),
    embedFont('IBM Plex Sans Condensed', 500),
    embedFont('IBM Plex Sans Condensed', 600),
    embedFont('IBM Plex Mono', 500),
    embedFont('Mrs Saint Delafield', 400),
  ]);

  await mkdir(new URL('../assets/', import.meta.url), { recursive: true });
  for (const [name, theme] of Object.entries(THEMES)) {
    const svg = render(theme, profile, { avatar, fonts: fonts.join('') });
    await writeFile(new URL(`../assets/id-card-${name}.svg`, import.meta.url), svg);
    console.log(`assets/id-card-${name}.svg  ${Math.round(svg.length / 1024)} KB`);
  }
  console.log(`${profile.contributions} contributions over ${profile.weeks.length} weeks`);
}

// ---------------------------------------------------------------------------
// Data

async function get(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res;
}

async function dataUri(url, init) {
  const res = await get(url, init);
  const type = res.headers.get('content-type')?.split(';')[0] || 'application/octet-stream';
  return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
}

async function embedFont(family, weight) {
  const query = `family=${family.replace(/ /g, '+')}:wght@${weight}&text=${encodeURIComponent(GLYPHS)}`;
  const css = await (
    await get(`https://fonts.googleapis.com/css2?${query}`, { headers: { 'User-Agent': BROWSER_UA } })
  ).text();
  const src = css.match(/url\((https:[^)]+)\)/)?.[1];
  if (!src) throw new Error(`Google Fonts returned no font file for ${family} ${weight}`);
  return `@font-face{font-family:'${family}';font-weight:${weight};src:url(${await dataUri(src)}) format('woff2')}`;
}

function fetchProfile(login) {
  return TOKEN ? fetchWithGraphQL(login) : fetchPublic(login);
}

async function fetchWithGraphQL(login) {
  const query = `query($login: String!) {
    user(login: $login) {
      databaseId location createdAt avatarUrl(size: 400)
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks { firstDay contributionDays { weekday contributionCount } }
        }
      }
    }
  }`;
  const res = await get('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { login } }),
  });
  const { data, errors } = await res.json();
  if (errors) throw new Error(errors.map((e) => e.message).join('; '));
  const { user } = data;
  const calendar = user.contributionsCollection.contributionCalendar;
  return {
    id: user.databaseId,
    location: user.location,
    createdAt: user.createdAt,
    avatarUrl: user.avatarUrl,
    contributions: calendar.totalContributions,
    weeks: calendar.weeks.map((w) => {
      const days = Array(7).fill(null);
      for (const d of w.contributionDays) days[d.weekday] = d.contributionCount;
      return { start: w.firstDay, days };
    }),
  };
}

// Without a token: the REST API plus the contribution calendar the profile page loads.
async function fetchPublic(login) {
  const user = await (await get(`https://api.github.com/users/${login}`)).json();
  const html = await (await get(`https://github.com/users/${login}/contributions`)).text();
  // Day cells have ids ending in -<weekday>-<week>, and a tooltip like "9 contributions on October 26th."
  const weeks = [];
  for (const [, date, day, week] of html.matchAll(/data-date="([\d-]+)" id="contribution-day-component-(\d+)-(\d+)"/g)) {
    const w = (weeks[week] ??= { start: date, days: Array(7).fill(null) });
    if (date < w.start) w.start = date;
    w.days[day] = 0;
  }
  for (const [, day, week, text] of html.matchAll(/for="contribution-day-component-(\d+)-(\d+)"[^>]*>([^<]*)<\/tool-tip>/g)) {
    if (weeks[week]) weeks[week].days[day] = parseInt(text.replace(/,/g, ''), 10) || 0;
  }
  const sum = (w) => w.days.reduce((a, n) => a + (n ?? 0), 0);
  const total = html.match(/([\d,]+)\s+contributions?\s+in the last year/);
  return {
    id: user.id,
    location: user.location,
    createdAt: user.created_at,
    avatarUrl: `${user.avatar_url}&s=400`,
    contributions: total ? parseInt(total[1].replace(/,/g, ''), 10) : weeks.reduce((a, w) => a + sum(w), 0),
    weeks,
  };
}

// ---------------------------------------------------------------------------
// Code lines: styled after a passport's machine-readable zone, but written to read in order.

function mrzText(s) {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '<');
}

const pad = (s, n) => s.padEnd(n, '<').slice(0, n);

// Name and role on the first line; ID, employer and stack on the second.
function mrz({ id }) {
  return [
    pad(`${mrzText(CARD.givenNames)}<${mrzText(CARD.surname)}<<${mrzText(CARD.role)}`, 36),
    pad(`ID<${id}<<${mrzText(CARD.employer)}<<${mrzText(CARD.stackCode)}`, 36),
  ];
}

// ---------------------------------------------------------------------------
// Drawing

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const repeatTo = (s, n) => s.repeat(Math.ceil(n / s.length)).slice(0, n);
const MONTHS = 'JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split(' ');
const formatDate = (iso) => {
  const d = new Date(iso);
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

// Hypotrochoid: the spirograph curve behind banknote and ID-card guilloche patterns.
function rosette(cx, cy, R, r, d, steps = 900) {
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const turns = r / gcd(R, r);
  const k = (R - r) / r;
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = (2 * Math.PI * turns * i) / steps;
    const x = cx + (R - r) * Math.cos(t) + d * Math.cos(k * t);
    const y = cy + (R - r) * Math.sin(t) - d * Math.sin(k * t);
    points.push(`${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return `M${points.join(' ')}`;
}

function wavePattern(id, t) {
  const width = 160;
  const lines = [];
  for (let i = 0; i < 11; i++) {
    const points = [];
    for (let x = 0; x <= width; x += 4) {
      points.push(`${x} ${(14 + i * 7 + 5 * Math.sin((2 * Math.PI * x) / width + i * 0.55)).toFixed(1)}`);
    }
    lines.push(`M${points.join(' ')}`);
  }
  return `<pattern id="${id}" width="${width}" height="112" patternUnits="userSpaceOnUse"><path d="${lines.join('')}" fill="none" stroke="${t.pattern}" stroke-opacity="${t.waveOpacity}" stroke-width=".6"/></pattern>`;
}

// A month label at the first week of each month.
function monthTicks(weeks, x0, pitch, y) {
  const month = (w) => Number(w.start.slice(5, 7)) - 1;
  return weeks
    .map((w, i) => {
      if (i > 0 && month(w) === month(weeks[i - 1])) return '';
      // Skip a leading partial month when the next label would crowd it.
      if (i === 0 && weeks.findIndex((v) => month(v) !== month(w)) < 3) return '';
      return `<text x="${(x0 + i * pitch).toFixed(1)}" y="${y}" class="tick">${MONTHS[month(w)]}</text>`;
    })
    .join('');
}

// One bar per week, height proportional to that week's contributions.
function activityBars(weeks, t) {
  const x0 = 256, width = 400, base = 432, maxHeight = 30;
  const totals = weeks.map((w) => w.days.reduce((a, n) => a + (n ?? 0), 0));
  const max = Math.max(1, ...totals);
  const pitch = width / weeks.length;
  const bars = totals.map((n, i) => {
    const h = n ? Math.max(1.5, (n / max) * maxHeight) : 1;
    return `<rect x="${(x0 + i * pitch).toFixed(2)}" y="${(base - h).toFixed(2)}" width="${(pitch * 0.62).toFixed(2)}" height="${h.toFixed(2)}" rx="1"${n ? '' : ' opacity=".35"'}/>`;
  });
  return `<text x="${x0}" y="394" class="lbl">CONTRIBUTIONS PER WEEK</text>
<g fill="${t.accent}">${bars.join('')}</g>
<path d="M${x0} ${base + 0.5}H${x0 + width}" stroke="${t.hair}"/>
${monthTicks(weeks, x0, pitch, 446)}`;
}

// Place the shared avatar so the configured crop fills the frame.
function avatarUse(frame, attrs = '') {
  const { centerX, top, width } = CARD.photoCrop;
  const scale = frame.w / width;
  const x = frame.x - (centerX - width / 2) * scale;
  const y = frame.y - top * scale;
  return `<use href="#avatar" transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${scale.toFixed(4)})" ${attrs}/>`;
}

function render(t, p, { avatar, fonts }) {
  const photo = { x: 44, y: 130, w: 184, h: 230 };
  const ghost = { x: 708, y: 128, w: 84, h: 105 };
  const cols = [256, 464, 680];
  const [mrz1, mrz2] = mrz(p);
  const field = (x, y, label, value, cls = 'val') =>
    `<text x="${x}" y="${y}" class="lbl">${esc(label)}</text><text x="${x}" y="${y + 24}" class="${cls}">${esc(value)}</text>`;
  const description = `${CARD.role} at ${CARD.employer}. ${CARD.stack}. ${p.location ?? ''}. ${p.contributions.toLocaleString('en-US')} contributions in the last year.`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="888" height="594" viewBox="0 0 888 594" role="img" aria-labelledby="t d">
<title id="t">${esc(CARD.title)}: ${esc(CARD.signature)}</title>
<desc id="d">${esc(description)}</desc>
<defs>
<style>
${fonts}
text{font-family:'IBM Plex Sans Condensed','Arial Narrow','Roboto Condensed',sans-serif;fill:${t.ink}}
.lbl{font-size:10.5px;font-weight:500;letter-spacing:2.2px;fill:${t.muted}}
.issuer{font-size:12.5px;font-weight:500;letter-spacing:4px;fill:${t.muted}}
.title{font-size:20px;font-weight:600;letter-spacing:3.5px}
.name{font-size:46px;font-weight:600;letter-spacing:1.5px}
.given{font-size:32px;font-weight:600;letter-spacing:1px}
.val{font-size:18px;font-weight:600;letter-spacing:.8px}
.stat{font-size:32px;font-weight:600;letter-spacing:.5px}
.mono,.mrz,.micro,.ring,.seal,.tick{font-family:'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-weight:500}
.mono{font-size:17px;letter-spacing:1px}
.tick{font-size:9px;letter-spacing:1px;fill:${t.muted}}
.mrz{font-size:20px;fill:${t.mrzInk}}
.micro{font-size:5.4px;fill:${t.muted};opacity:.75}
.ring{font-size:5.6px;fill:${t.muted}}
.seal{font-size:15px;fill:#1E293B;opacity:.75}
.sig{font-family:'Mrs Saint Delafield','Brush Script MT',cursive;font-size:44px;fill:${t.sig}}
.sheen{animation:sheen 10s cubic-bezier(.45,0,.25,1) 3s infinite}
.spin{transform-box:fill-box;transform-origin:center;animation:spin 18s linear infinite}
@keyframes sheen{0%{transform:translateX(0)}45%,100%{transform:translateX(1600px)}}
@keyframes spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.sheen,.spin{animation:none}}
</style>
<image id="avatar" href="${avatar}" width="400" height="400"/>
<clipPath id="card"><rect width="840" height="530" rx="26"/></clipPath>
<clipPath id="photo"><rect x="${photo.x}" y="${photo.y}" width="${photo.w}" height="${photo.h}" rx="12"/></clipPath>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${t.bg[0]}"/><stop offset="1" stop-color="${t.bg[1]}"/></linearGradient>
<radialGradient id="glow" cx=".85" cy=".1" r=".7"><stop offset="0" stop-color="${t.glow}" stop-opacity="${t.glowOpacity}"/><stop offset="1" stop-color="${t.glow}" stop-opacity="0"/></radialGradient>
<linearGradient id="holo" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#67E8F9"/><stop offset=".3" stop-color="#A5B4FC"/><stop offset=".55" stop-color="#F5D0FE"/><stop offset=".8" stop-color="#FDE68A"/><stop offset="1" stop-color="#86EFAC"/></linearGradient>
<linearGradient id="sheenFill" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity="${t.sheenOpacity}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<radialGradient id="ghostFade" cx=".5" cy=".45" r=".6"><stop offset=".5" stop-color="#fff"/><stop offset="1" stop-color="#000"/></radialGradient>
<mask id="ghostMask"><rect x="${ghost.x}" y="${ghost.y}" width="${ghost.w}" height="${ghost.h}" fill="url(#ghostFade)"/></mask>
<filter id="ghost" color-interpolation-filters="sRGB"><feColorMatrix values="${t.ghost}"/></filter>
<filter id="shadow" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dy="12" stdDeviation="12" flood-color="#000" flood-opacity="${t.shadowOpacity}"/></filter>
<path id="rose-outer" d="${rosette(0, 0, 144, 54, 64)}"/>
<path id="rose-inner" d="${rosette(0, 0, 144, 54, 28)}"/>
<path id="ring" d="M-38 0a38 38 0 1 1 76 0a38 38 0 1 1-76 0"/>
${wavePattern('waves', t)}
</defs>
<g transform="translate(24 20)">
<rect width="840" height="530" rx="26" fill="url(#bg)" filter="url(#shadow)"/>
<g clip-path="url(#card)">
<rect width="840" height="530" fill="url(#glow)"/>
<rect width="840" height="112" fill="url(#waves)"/>
<g fill="none" stroke="${t.pattern}" stroke-opacity="${t.patternOpacity}" stroke-width=".45" transform="translate(620 240)">
${[0, 1, 2, 3, 4, 5].map((i) => `<use href="#rose-outer" transform="rotate(${i * 7.5})"/><use href="#rose-inner" transform="rotate(${i * 7.5 + 3.75})"/>`).join('')}
</g>
<rect y="456" width="840" height="74" fill="${t.mrzPanel}"/>
<path d="M0 456.5H840" stroke="${t.hair}"/>
</g>

<text x="44" y="50" class="issuer">${esc(CARD.issuer.toUpperCase())}</text>
<text x="44" y="78" class="title">${esc(CARD.title.toUpperCase())}</text>
<text x="44" y="106" class="micro" textLength="640" lengthAdjust="spacing">${esc(repeatTo(`${CARD.signature} · ${CARD.role} · `.toUpperCase(), 198))}</text>

<g transform="translate(772 60)">
<circle r="32" fill="url(#holo)" class="spin"/>
<path d="${rosette(0, 0, 24, 9, 13, 420)}" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width=".6"/>
<circle r="32" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width=".8"/>
<text y="5" text-anchor="middle" class="seal">&lt;/&gt;</text>
<text class="ring"><textPath href="#ring" textLength="236" lengthAdjust="spacing">${esc(repeatTo('OPEN SOURCE · VERIFIED DEVELOPER · ', 70))}</textPath></text>
</g>

<g clip-path="url(#photo)">${avatarUse(photo)}</g>
<rect x="${photo.x + 0.5}" y="${photo.y + 0.5}" width="${photo.w - 1}" height="${photo.h - 1}" rx="11.5" fill="none" stroke="${t.border}"/>
<g mask="url(#ghostMask)" opacity="${t.ghostOpacity}">${avatarUse(ghost, 'filter="url(#ghost)"')}</g>

<text x="${cols[0]}" y="140" class="lbl">SURNAME</text>
<text x="${cols[0]}" y="186" class="name">${esc(CARD.surname.toUpperCase())}</text>
<text x="${cols[0]}" y="214" class="lbl">GIVEN NAMES</text>
<text x="${cols[0]}" y="250" class="given">${esc(CARD.givenNames.toUpperCase())}</text>
${field(cols[1], 214, 'EMPLOYER', CARD.employer.toUpperCase())}
${field(cols[0], 286, 'ROLE', CARD.role.toUpperCase())}
${field(cols[1], 286, 'STACK', CARD.stack.toUpperCase())}
${field(cols[2], 286, 'LOCATION', (p.location ?? '—').toUpperCase())}
${field(cols[0], 338, 'ID NO.', p.id, 'mono')}
${field(cols[1], 338, 'ISSUED', formatDate(p.createdAt), 'mono')}
${field(cols[2], 338, 'EXPIRES', 'NEVER')}

<text x="44" y="394" class="lbl">HOLDER'S SIGNATURE</text>
<text x="40" y="436" class="sig" transform="rotate(-4 40 436)">${esc(CARD.signature)}</text>

${activityBars(p.weeks, t)}
<text x="${cols[2]}" y="394" class="lbl">TOTAL</text>
<text x="${cols[2]}" y="427" class="stat">${p.contributions.toLocaleString('en-US')}</text>
<text x="${cols[2]}" y="443" class="lbl">LAST 12 MONTHS</text>

<text x="44" y="489" class="mrz" textLength="752" lengthAdjust="spacing">${esc(mrz1)}</text>
<text x="44" y="516" class="mrz" textLength="752" lengthAdjust="spacing">${esc(mrz2)}</text>

<g clip-path="url(#card)"><g transform="rotate(18 420 265)"><rect class="sheen" x="-520" y="-200" width="240" height="930" fill="url(#sheenFill)"/></g></g>
<rect x=".5" y=".5" width="839" height="529" rx="25.5" fill="none" stroke="${t.border}"/>
</g>
</svg>
`;
}

await main();
