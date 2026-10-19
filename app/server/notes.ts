import type { Story } from "#src/paper.ts";

// "Save to notes": a story goes into the reader's Aletheia Inbox through its capture API
// (POST <app>/api/capture), with a capture key, which can only add items, never read or change them, so
// this server never holds the key that opens the notes. Aletheia files it under Inbox › <today's date>.
// Without ALETHEIA_CAPTURE_KEY nothing offers to save.
const KEY = process.env.ALETHEIA_CAPTURE_KEY ?? "";
const APP = (process.env.ALETHEIA_URL || "https://aletheia.hamzatekin.dev").replace(/\/$/, "");

export const canSaveNotes = () => KEY !== "";

export type Saved = { ok: true; url: string } | { ok: false; error: string };

export async function saveToNotes(story: Story, opts: { label: string; contextLabel?: string; timezone?: string }): Promise<Saved> {
  const note = [
    story.source,
    story.body,
    story.context && `**${opts.contextLabel ?? "Context"}:** ${story.context}`,
    `Saved from the ${opts.label} paper.`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const body = { title: story.headline, note, under: "Inbox", tz: opts.timezone ?? process.env.TZ ?? "" };
  try {
    const res = await fetch(`${APP}/api/capture`, {
      method: "POST",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const got = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!res.ok || !got.url) return { ok: false, error: got.error ?? `Aletheia answered ${res.status}` };
    return { ok: true, url: got.url };
  } catch (err) {
    return { ok: false, error: `Aletheia did not answer: ${err instanceof Error ? err.message : err}` };
  }
}
