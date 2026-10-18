// Writes notes.md in the current directory, for the today task: the reader's notes from Aletheia, their
// own outliner, through its read-only feed (GET <url> with `Authorization: Bearer $ALETHEIA_TOKEN`).
// Aletheia sends only the piles on its allow-list (never Passwords, Budget or Journal), as a flat list of
// nodes with their path, text, note and created and updated times. The raw feed is not kept; only
// notes.md, in the run directory, which the private Today page is built from. Config from
// $TASK_DIR/task.json under "aletheia":
//   url          the feed
//   importedOn   the day everything was imported into Aletheia: a node created that day may be older
//   recentDays   what counts as "changed lately" (default 7); a Work or Projects topic edited in twice
//                that is shown with what is under it, an older one by its first line only
//   full         piles shown whole, every item with its age (default Inbox, Alınacaklar)
//   outline      piles shown by topic (default Work, Projects); every other pile is reference material
//                (book notes, film lists) and gets one line, plus its recent changes
//   maxChars     size cap for notes.md (default 90000); long texts are cut shorter until it fits
//   app          where the reader opens Aletheia (default https://aletheia.hamzatekin.dev); every note in
//                notes.md carries a short reference ([n12]), and links.json maps each to <app>/n/<id>, so a
//                story whose source is a reference links to its note (the runner swaps it in)
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

type Node = { id: string; parentId: string | null; path: string[]; text: string; note: string | null; order: number; done?: boolean; createdAt: string; updatedAt: string };

const config = JSON.parse(await readFile(join(process.env.TASK_DIR!, "task.json"), "utf8"));
const cfg = config.aletheia ?? {};
const token = process.env.ALETHEIA_TOKEN;
if (!token) {
  console.error("ALETHEIA_TOKEN is not set");
  process.exit(1);
}
const zone: string = config.timezone ?? "Europe/London";
const recentDays: number = cfg.recentDays ?? 7;
const full: string[] = cfg.full ?? ["Inbox", "Alınacaklar"];
const outline: string[] = cfg.outline ?? ["Work", "Projects"];
const maxChars: number = cfg.maxChars ?? 90_000;
const importedOn: string = cfg.importedOn ?? "";
const app: string = (cfg.app ?? "https://aletheia.hamzatekin.dev").replace(/\/$/, "");

const res = await fetch(cfg.url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
if (!res.ok) {
  console.error(`aletheia: ${res.status} ${res.statusText}`);
  process.exit(1);
}
const feed: { generatedAt: string; nodes: Node[] } = await res.json();
const now = Date.now();
const recent = now - recentDays * 86_400_000;
const fresh = now - 2 * recentDays * 86_400_000;
const items = (n: number) => `${n} ${n === 1 ? "item" : "items"}`;

const children = new Map<string | null, Node[]>();
for (const n of feed.nodes) children.set(n.parentId, [...(children.get(n.parentId) ?? []), n]);
for (const list of children.values()) list.sort((a, b) => a.order - b.order);
const kids = (n: Node) => children.get(n.id) ?? [];
const piles = children.get(null) ?? [];
const pileOf = (n: Node) => n.path[0] ?? n.text;

// The newest edit anywhere under a node, and how many nodes it holds.
function subtree(n: Node): { updated: string; count: number } {
  let updated = n.updatedAt;
  let count = 1;
  for (const k of kids(n)) {
    const s = subtree(k);
    if (s.updated > updated) updated = s.updated;
    count += s.count;
  }
  return { updated, count };
}

const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: zone, day: "numeric", month: "short" }).format(new Date(iso));
const ageDays = (iso: string) => Math.floor((now - Date.parse(iso)) / 86_400_000);
const ago = (n: number) => (n === 0 ? "today" : n === 1 ? "1 day ago" : `${n} days ago`);
// A node created on the import day may be years old; its age is "at least".
const created = (n: Node) => {
  const imported = importedOn && n.createdAt.startsWith(importedOn);
  return imported ? `created ${day(n.createdAt)} or before, ${ageDays(n.createdAt)}+ days ago` : `created ${day(n.createdAt)}, ${ago(ageDays(n.createdAt))}`;
};
const edited = (n: Node) => (n.updatedAt.slice(0, 16) !== n.createdAt.slice(0, 16) ? `, edited ${day(n.updatedAt)}` : "");
// A note's short reference, the same wherever it appears: a 36-character id on every line would cost
// more tokens than the notes. Numbered in the order notes.md first shows them.
const refs = new Map<string, string>();
const ref = (n: Node) => {
  if (!refs.has(n.id)) refs.set(n.id, `n${refs.size + 1}`);
  return `[${refs.get(n.id)}]`;
};
const flat = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

let cut = 400;
const clip = (s: string | null | undefined, max = cut) => {
  const t = flat(s);
  return t.length > max ? `${t.slice(0, max)}…` : t;
};
const line = (n: Node, depth: number, dates: string) => {
  const text = clip(n.text) || "(no text)";
  const note = clip(n.note);
  return `${"  ".repeat(depth)}- ${ref(n)} ${n.done ? "[done] " : ""}${text}${note ? ` — note: ${note}` : ""}${dates ? ` (${dates})` : ""}\n`;
};

// A node and everything under it, an empty line left out but not its children. Dates on the first level
// only, and on a deeper node added on a later day than its parent.
function tree(n: Node, depth: number, maxDepth: number, parent?: Node): string {
  let out = "";
  const later = parent && day(n.createdAt) !== day(parent.createdAt);
  const dates = depth === 0 ? created(n) + edited(n) : later ? `added ${day(n.createdAt)}` : "";
  if (flat(n.text) || flat(n.note)) out += line(n, depth, dates);
  if (depth < maxDepth) for (const k of kids(n)) out += tree(k, depth + 1, maxDepth, n);
  else if (kids(n).length) out += `${"  ".repeat(depth + 1)}- (${items(subtree(n).count - 1)} more under this)\n`;
  return out;
}

function render(): string {
  const today = new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(now));
  refs.clear();
  let out = `# The reader's notes (Aletheia), ${today}\n\n`;
  out += `Today is ${today}. ${feed.nodes.length} notes in the piles the assistant may read.`;
  if (importedOn) out += ` Everything was imported into Aletheia on ${day(importedOn)}, so a note "created ${day(importedOn)} or before" may be much older; its text sometimes carries its real date.`;
  out += ` Struck-through text (~~like this~~) is done. Each note starts with its reference in square brackets, like [n12].\n\n`;

  // What the reader touched lately, newest first: the clearest sign of what is on their mind.
  const changed = feed.nodes.filter((n) => n.parentId && Date.parse(n.updatedAt) >= recent && (flat(n.text) || flat(n.note))).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  out += `## Changed in the last ${recentDays} days (${changed.length})\n\n`;
  for (const n of changed.slice(0, 150)) {
    const where = [pileOf(n), ...n.path.slice(1)].join(" / ") || "(top level)";
    const isNew = n.createdAt.slice(0, 16) === n.updatedAt.slice(0, 16);
    out += `- ${ref(n)} (${where}) ${clip(n.text, Math.min(cut, 200)) || "(no text)"}${n.note ? ` — note: ${clip(n.note, Math.min(cut, 200))}` : ""} (${isNew ? "new" : "edited"} ${day(n.updatedAt)})\n`;
  }
  if (changed.length > 150) out += `- (${changed.length - 150} more)\n`;

  for (const pile of piles) {
    const name = pile.text;
    const { updated, count } = subtree(pile);
    if (full.includes(name)) {
      out += `\n## ${name} (${items(count - 1)}, last edited ${day(updated)})\n\n`;
      for (const k of kids(pile)) out += tree(k, 0, 4);
      if (!kids(pile).length) out += "(empty)\n";
    } else if (outline.includes(name)) {
      out += `\n## ${name} (${items(count - 1)}, last edited ${day(updated)}), by topic\n`;
      // Recently edited topics first. Under each, an item edited lately is shown with what is under it;
      // older items by their first line only, at most 15 of them.
      const topics = kids(pile).map((k) => ({ k, ...subtree(k) })).sort((a, b) => b.updated.localeCompare(a.updated));
      for (const t of topics) {
        out += `\n### ${ref(t.k)} ${clip(t.k.text, 120) || "(no title)"} (${items(t.count - 1)}, ${created(t.k)}, last edited ${day(t.updated)})\n`;
        if (t.k.note) out += `${clip(t.k.note)}\n`;
        let older = 0;
        for (const k of kids(t.k)) {
          if (Date.parse(subtree(k).updated) >= fresh) out += tree(k, 0, 3, t.k);
          else if (older++ < 15) out += line(k, 0, "");
        }
        if (older > 15) out += `- (${older - 15} older items)\n`;
      }
    }
  }

  out += `\n## Reference piles (notes to look things up in, not tasks; their recent changes are listed above)\n\n`;
  for (const pile of piles.filter((p) => !full.includes(p.text) && !outline.includes(p.text))) {
    const { updated, count } = subtree(pile);
    out += `- ${pile.text}: ${items(count - 1)}, last edited ${day(updated)}\n`;
  }
  return out;
}

let out = render();
while (out.length > maxChars && cut > 80) {
  cut = Math.floor(cut * 0.75);
  out = render();
}
await writeFile("notes.md", out);
await writeFile("links.json", JSON.stringify(Object.fromEntries([...refs].map(([id, r]) => [r, `${app}/n/${id}`])), null, 2));
console.log(`aletheia: ${feed.nodes.length} nodes in ${piles.length} piles, generated ${feed.generatedAt}; notes.md ${out.length} chars (texts cut at ${cut})`);
