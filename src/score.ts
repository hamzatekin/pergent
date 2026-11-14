// A homes listing's score out of 10, counted by code from task.json's "score" points: its space, EPC,
// commute, crime and heating, plus extras (a supermarket near, a direct trip to the first commute place,
// a quiet street, parking, a garden, furnished). The facts are what was collected (commute, crime, the
// agent's ticks, src/shops.ts) and what the read took from the text (EPC, lounge, heating, garden,
// parking, street, red flags), so the same facts always give the same score and each point can be shown.
// A studio or a dealbreaking red flag (shared, students only, a short let) caps it at 1, very high crime
// at `veryHighCrime`; any other red flag (a deposit over the legal cap is one) takes `redFlag` off.
// Unread listings have no score. Changing a weight re-scores every listing at once: nothing is stored.
import { depositOver } from "./compare.ts";
import type { HomeRow } from "./db.ts";
import type { TaskConfig } from "./runner.ts";
import { nearestShop, shopText, type Shop } from "./shops.ts";

export type ScoreConfig = {
  beds: { two: number; oneWithLounge: number; one: number };
  /** The EPC by its number (1 to 100) rather than its band: nothing up to `zero`, `points` from `full`, in a
   * straight line between, so a low C (69) scores about as a high D (68) and a high C (80) more. */
  epc: { zero: number; full: number; points: number };
  /** Per commute place, [most minutes, points] steps. The first place is the one a direct trip counts for. */
  commute: Record<string, [number, number][]>;
  crime: Record<string, number>;
  heating: Record<string, number>;
  /** Points for two extras or more, and for four or more. */
  extras: { two: number; four: number };
  veryHighCrime: number;
  redFlag: number;
  /** A good score: the page's chip, and what a match needs for a message. */
  good: number;
};

const DEFAULTS: ScoreConfig = {
  beds: { two: 2, oneWithLounge: 2, one: 1.5 },
  epc: { zero: 55, full: 92, points: 2 },
  commute: {},
  crime: { "very low": 1.5, low: 1, average: 0.5 },
  heating: { gas: 1, "heat pump": 1, communal: 0.5, "not said": 0.5 },
  extras: { two: 0.5, four: 1 },
  veryHighCrime: 4,
  redFlag: -1,
  good: 6,
};

export const scoreConfig = (config: TaskConfig | undefined): ScoreConfig => {
  const s: ScoreConfig = { ...DEFAULTS, ...((config?.score ?? {}) as Partial<ScoreConfig>) };
  // The points by band this replaced ({ A: 2, B: 1.5, C: 1 }) would give every listing NaN.
  if (typeof s.epc.zero !== "number" || typeof s.epc.full !== "number" || typeof s.epc.points !== "number") s.epc = DEFAULTS.epc;
  return s;
};

// The middle of each band's numbers, for a listing whose EPC gives only its band.
const BAND_MIDDLE: Record<string, number> = { A: 96, B: 86, C: 74, D: 61, E: 46, F: 29, G: 10 };

// The EPC's number: the chart's, else the register certificate's when it was matched by the home's address
// or is the only one at the postcode, and has the same band (src/epc.ts), else the middle of the band.
function epcNumber(h: HomeRow): { n: number; guessed: boolean } | null {
  const band = h.read?.epcBand;
  if (!band) return null;
  if (h.read?.epcScore) return { n: h.read.epcScore, guessed: false };
  const c = h.cert?.cert;
  if (c?.score && c.band === band && (h.cert?.how === "address" || h.cert?.how === "only")) return { n: c.score, guessed: false };
  return BAND_MIDDLE[band] ? { n: BAND_MIDDLE[band], guessed: true } : null;
}

// Red flags that make a listing no home for the reader at all.
// The flag names the dealbreaker itself: "near student halls" or "box room in the attic" is not one.
const DEALBREAKER = /students? only|for students|student (let|accommodation|property)|room in a shared|shared house|house ?share|\bhmo\b|\blodgers?\b|short[- ]?let|holiday let|\bstudio\b|\bbedsit\b/i;
// The read's red flags less those about what is counted on its own: the crime level, and the deposit
// when code has found it over the legal cap (src/compare.ts), which reads sometimes flag too.
export const redFlagsOf = (flags: string[], depositOver: boolean) => flags.filter((f) => !/crime/i.test(f) && !(depositOver && /deposit/i.test(f)));
// The agent's parking ticks that mean a space of the home's own (not on the street or by permit).
const PARKING = /^(yes|off street|private|driveway|allocated|garage|gated|undercroft|underground|rear|communal)/i;
const HEATING: Record<string, string> = { gas: "gas heating", electric: "electric heating", communal: "communal heating", "not said": "heating not said" };

export type Score = { score: number; parts: { label: string; points: number }[]; cap: string | null };

export function scoreOf(h: HomeRow, s: ScoreConfig, near: { shops: Shop[]; metres: number } | null): Score | null {
  const r = h.read;
  if (!r) return null;
  const parts: Score["parts"] = [];
  const add = (label: string, points: number) => parts.push({ label, points });
  const beds = h.beds ?? 0;
  const studio = beds === 0 || r.livingRoom === "none";
  if (studio) add("studio", 0);
  else if (beds >= 2) add(`${beds} beds`, s.beds.two);
  else if (r.livingRoom === "separate") add("1 bed with a separate lounge", s.beds.oneWithLounge);
  else add(`1 bed, ${r.livingRoom === "open plan" ? "open-plan lounge" : "lounge not said"}`, s.beds.one);
  const epc = epcNumber(h);
  const share = epc ? Math.min(1, Math.max(0, (epc.n - s.epc.zero) / (s.epc.full - s.epc.zero))) : 0;
  add(epc ? `EPC ${r.epcBand}${epc.guessed ? " (no number)" : ` ${epc.n}`}` : "EPC unknown", Math.round(share * s.epc.points * 10) / 10);
  for (const [place, steps] of Object.entries(s.commute)) {
    const t = h.commute[place];
    if (!t) {
      add(`${place} not timed yet`, 0);
      continue;
    }
    const step = t.min === null ? undefined : [...steps].sort((a, b) => a[0] - b[0]).find(([max]) => t.min! <= max);
    add(`${place} ${t.min ?? "over 90"} min`, step?.[1] ?? 0);
  }
  add(h.crime ? `crime ${h.crime.level}` : "crime not known", (h.crime && s.crime[h.crime.level]) || 0);
  add(HEATING[r.heating] ?? r.heating, s.heating[r.heating] ?? 0);
  const extras: string[] = [];
  const shop = near ? nearestShop(h.lat, h.lng, near.shops) : null;
  if (shop && near && shop.metres <= near.metres) extras.push(shopText(shop));
  const first = Object.keys(s.commute)[0];
  const via = first ? h.commute[first]?.via : undefined;
  if (via && !via.includes("+")) extras.push(`${via} to ${first.toLowerCase()}, no change`);
  if (r.street === "quiet") extras.push("quiet street");
  if (r.parking === "private" || (h.details?.features.parking ?? []).some((v) => PARKING.test(v))) extras.push("parking");
  if (r.garden === "private" || r.garden === "shared") extras.push(`${r.garden} garden`);
  const furnish = h.details?.furnish ?? "";
  if (/^part furnished/i.test(furnish)) extras.push("part furnished");
  else if (/^furnished/i.test(furnish)) extras.push("furnished");
  add(extras.length ? `extras: ${extras.join(", ")}` : "no extras", extras.length >= 4 ? s.extras.four : extras.length >= 2 ? s.extras.two : 0);
  const flags = [...(depositOver(h) ? ["deposit over the legal cap"] : []), ...redFlagsOf(r.redFlags, !!depositOver(h))];
  const dealbreaker = flags.find((f) => DEALBREAKER.test(f)) ?? null;
  for (const f of flags) if (!(studio && /studio|bedsit/i.test(f))) add(f, f === dealbreaker ? 0 : s.redFlag);
  // To one decimal, so the EPC number shows: a C 69 and a C 80 in the same place differ by 0.6.
  let score = Math.round(Math.min(10, Math.max(0, parts.reduce((t, p) => t + p.points, 0))) * 10) / 10;
  let cap: string | null = null;
  if ((studio || dealbreaker) && score > 1) {
    cap = studio ? "a studio" : dealbreaker;
    score = 1;
  } else if (!studio && !dealbreaker && h.crime?.level === "very high" && score > s.veryHighCrime) {
    cap = "very high crime";
    score = s.veryHighCrime;
  }
  return { score, parts, cap };
}

const num = (n: number) => (n < 0 ? `−${-n}` : String(n));

// "6/10".
export const scoreLabel = (sc: Score) => `${num(sc.score)}/10`;

// "2 beds 2 · EPC B 1.5 · Work 33 min 0.5 · … · capped at 4 for very high crime"; `short` leaves out the
// parts that scored nothing (for a Telegram caption, which holds 1,024 characters).
export const scoreParts = (sc: Score, short = false) =>
  [...sc.parts.filter((p) => !short || p.points !== 0).map((p) => `${p.label} ${num(p.points)}`), ...(sc.cap ? [`capped at ${num(sc.score)} for ${sc.cap}`] : [])].join(" · ");
