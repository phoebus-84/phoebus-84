#!/usr/bin/env node
// Draws a year of GitHub contributions as a slit scan in Star Gate mode:
// the contribution calendar becomes the two walls of a corridor, one week per
// slit, receding to a vanishing point. Same idea as frei0r's slitscan0r.
//
// The output is a single SVG animated with CSS only, because that is all a
// GitHub README will run. No dependencies.
//
//   GH_TOKEN=$(gh auth token) node scripts/stargate.mjs [login] [out.svg]

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The pangolin walking down the corridor: "Animal in the Form of a Pangolin",
// Lega, Art Institute of Chicago (artic.edu/artworks/32871), public domain,
// cut out of its photograph. Embedded, because a README image loads nothing.
const PANGOLIN = join(dirname(fileURLToPath(import.meta.url)), "../assets/pangolin.png");

const login = process.argv[2] ?? process.env.GITHUB_REPOSITORY_OWNER ?? "phoebus-84";
const out = process.argv[3] ?? "assets/stargate.svg";
const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
if (!token) {
  console.error("Set GH_TOKEN or GITHUB_TOKEN.");
  process.exit(1);
}

// ---- data -----------------------------------------------------------------

const query = `query($login:String!){ user(login:$login){ contributionsCollection{
  contributionCalendar{ totalContributions weeks{ contributionDays{ weekday contributionCount } } } } } }`;

const res = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: { authorization: `bearer ${token}`, "content-type": "application/json", "user-agent": "stargate-svg" },
  body: JSON.stringify({ query, variables: { login } }),
});
const body = await res.json();
if (!res.ok || body.errors) {
  console.error(JSON.stringify(body.errors ?? body, null, 2));
  process.exit(1);
}
const calendar = body.data.user.contributionsCollection.contributionCalendar;

// GitHub's own four levels are quartiles of the range, so one heavy day turns
// the rest of the year a single colour. Rank the active days instead: most of
// them stay in the violets, and the hot colours are kept for the busiest few.
const CUTS = [0.3, 0.52, 0.68, 0.8, 0.89, 0.95, 0.985]; // share of active days below each level
const active = calendar.weeks.flatMap((w) => w.contributionDays.map((d) => d.contributionCount)).filter((n) => n > 0).sort((a, b) => a - b);
const level = (count) => {
  if (count === 0) return 0;
  const rank = (active.findLastIndex((n) => n <= count) + 1) / active.length; // share of active days at or below this one
  return 1 + CUTS.filter((cut) => rank > cut).length;
};
// weeks[w][weekday] = 0..8, or undefined where the calendar has no day yet.
const weeks = calendar.weeks.map((w) => {
  const days = new Array(7);
  for (const d of w.contributionDays) days[d.weekday] = level(d.contributionCount);
  return days;
});
const N = weeks.length;

// ---- geometry -------------------------------------------------------------

const W = 840; // frame, 2.59:1 like the Cinerama prints of 2001
const H = 324;
const STRIP = 36; // black band under the frame, for the caption
const K = 1.07; // each slit is K times closer than the next one
const VISIBLE = 72; // slits drawn beyond the nearest one before they are sub-pixel
const SECONDS_PER_WEEK = 0.24;

const WALL_X = (W / 2) * 1.1; // where a wall crosses the picture plane
const WALL_H = (H / 2) * 3; // half the height of a wall, there
const ROW_GAP = 0.035; // dark line between days, as a share of a row
const SLIT_GAP = 0.1; // dark line between weeks, as a share of a slit

const f = (n) => +n.toFixed(2);

// One quad per weekday, on the right wall, for the nearest slit. Every other
// slit is this one scaled about the vanishing point, which sits at 0,0.
const far = K ** -(1 - SLIT_GAP);
const rowH = (2 * WALL_H) / 7;
const rows = Array.from({ length: 7 }, (_, r) => {
  const y0 = -WALL_H + r * rowH + (rowH * ROW_GAP) / 2;
  const y1 = y0 + rowH * (1 - ROW_GAP);
  const d = `M${f(WALL_X)} ${f(y0)}V${f(y1)}L${f(WALL_X * far)} ${f(y1 * far)}V${f(y0 * far)}Z`;
  return `<path id="d${r}" d="${d}"/>`;
});

// The floor between the walls, one band per slit. It only reflects them: it
// takes the colour of the week's busiest day, dimmed.
const floor = `<path id="fl" d="M${f(-WALL_X)} ${f(WALL_H)}H${f(WALL_X)}L${f(WALL_X * far)} ${f(WALL_H * far)}H${f(-WALL_X * far)}Z"/>`;

// The marker that passes once per loop: the seam between today and a year ago.
const nowFar = K ** -0.18;
const now = `<path id="now" d="M${f(WALL_X)} ${f(-WALL_H)}V${f(WALL_H)}L${f(WALL_X * nowFar)} ${f(WALL_H * nowFar)}V${f(-WALL_H * nowFar)}Z"/>`;

const slits = [];
const floors = [];
for (let i = 0; i < N + VISIBLE; i++) {
  const week = weeks[i % N];
  const scale = `transform="scale(${(K ** -i).toPrecision(5)})"`;
  const uses = week.map((level, r) => (level === undefined ? "" : `<use href="#d${r}" class="c${level}"/>`)).join("");
  const seam = i % N === 0 && i > 0 ? `<use href="#now" class="now"/>` : "";
  slits.push(`<g ${scale}>${uses}${seam}</g>`);
  floors.push(`<use href="#fl" ${scale} class="c${Math.max(0, ...week.filter((l) => l !== undefined))}"/>`);
}

// Flying one week forward is a scale by K about the vanishing point. A
// keyframe per week keeps the speed constant in depth, and the last frame
// shows the same weeks as the first, so the loop has no cut.
const frames = Array.from({ length: N + 1 }, (_, i) => `${f((i / N) * 100)}%{transform:scale(${(K ** i).toPrecision(6)})}`).join("");

// It stands on the floor at a fixed depth, so the walls fly past it and it
// seems to walk ahead of the camera. Its reflection is as faint as the floor's.
const pangolinSrc = `data:image/png;base64,${(await readFile(PANGOLIN)).toString("base64")}`;
const pDepth = 0.2; // the corridor's scale where it stands
const pFloor = WALL_H * pDepth; // the floor's height there
const pW = 2 * WALL_X * pDepth * 0.62; // most of the corridor's width
const pH = pW * (82 / 240);
const pX = -pW / 2;
const pY = pFloor - pH * 0.97;
const pImage = (extra = "") => `<image href="${pangolinSrc}" x="${f(pX)}" y="${f(pY)}" width="${f(pW)}" height="${f(pH)}"${extra}/>`;
const pangolin = `<g class="pango">
<ellipse cx="${f(pW * 0.04)}" cy="${f(pFloor)}" rx="${f(pW * 0.46)}" ry="${f(pH * 0.08)}" fill="#000" opacity=".6"/>
${pImage(` transform="translate(0 ${f(2 * pFloor)}) scale(1 -1)" opacity=".16"`)}
<g class="step">${pImage()}</g>
</g>`;

const total = calendar.totalContributions.toLocaleString("en-US");
const label = `A year of contributions by ${login} as a slit scan: ${total} contributions, one week per slit.`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-W / 2} ${-H / 2} ${W} ${H + STRIP}" width="${W}" height="${H + STRIP}" role="img" aria-label="${label}">
<title>${label}</title>
<style>
.c0{fill:#110c26}.c1{fill:#2a1a6e}.c2{fill:#4a1fa8}.c3{fill:#8a1fb0}.c4{fill:#d81f8f}.c5{fill:#ff4d5a}.c6{fill:#ff8a1f}.c7{fill:#ffc24a}.c8{fill:#fff3c4}
.floor{opacity:.22}
.now{fill:#fff}
.fly{animation:fly ${f(N * SECONDS_PER_WEEK)}s linear infinite}
@keyframes fly{${frames}}
.step{animation:step .48s ease-in-out infinite alternate}
@keyframes step{to{transform:translateY(-1.2px)}}
@media (prefers-reduced-motion:reduce){.fly,.step{animation:none}}
text{font:500 12.5px Futura,"Century Gothic","Avenir Next","Gill Sans",sans-serif;fill:#a9a294;letter-spacing:.04em}
</style>
<defs>
${rows.join("\n")}
${floor}
${now}
<clipPath id="frame"><rect x="${-W / 2}" y="${-H / 2}" width="${W}" height="${H}"/></clipPath>
<radialGradient id="haze"><stop offset="0" stop-color="#000"/><stop offset=".45" stop-color="#000" stop-opacity=".85"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
</defs>
<rect x="${-W / 2}" y="${-H / 2}" width="${W}" height="${H + STRIP}" fill="#000"/>
<g clip-path="url(#frame)">
<g class="fly">
<g id="wall">
${slits.join("\n")}
</g>
<use href="#wall" transform="scale(-1,1)"/>
<g class="floor">
<g id="floor">
${floors.join("\n")}
</g>
<use href="#floor" transform="scale(1,-1)"/>
</g>
</g>
<ellipse rx="34" ry="46" fill="url(#haze)"/>
${pangolin}
</g>
<text x="${-W / 2 + 16}" y="${H / 2 + 23}">One year of contributions through a slit scan, a week per slit</text>
<text x="${W / 2 - 16}" y="${H / 2 + 23}" text-anchor="end">${total} in the last year</text>
</svg>
`;

await mkdir(dirname(out), { recursive: true });
await writeFile(out, svg);
console.log(`${out}: ${N} weeks, ${total} contributions, ${(svg.length / 1024).toFixed(0)} KB`);
