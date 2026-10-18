import { useState } from "react";

// "Save to notes" in a story's foot: sends the story to your Aletheia Inbox (/admin/save). The script
// posts the form itself and the button turns into a link to the new note, so the paper keeps its place;
// without the script the form posts and the server sends you back to the paper.
export function SaveToNotes({ place, className }: { place: string; className: string }) {
  const [state, setState] = useState<{ kind: "idle" | "saving" | "failed" } | { kind: "saved"; url: string }>({ kind: "idle" });
  if (state.kind === "saved")
    return (
      <a className={className} href={state.url} target="_blank" rel="noopener" data-saved>
        Saved ↗
      </a>
    );
  return (
    <form
      className="save-form"
      method="post"
      action="/admin/save"
      onSubmit={async (e) => {
        e.preventDefault();
        const body = new FormData(e.currentTarget);
        setState({ kind: "saving" });
        try {
          const res = await fetch("/admin/save", { method: "POST", body, headers: { accept: "application/json" } });
          const got = (await res.json()) as { ok: boolean; url?: string };
          setState(got.ok && got.url ? { kind: "saved", url: got.url } : { kind: "failed" });
        } catch {
          setState({ kind: "failed" });
        }
      }}
    >
      <input type="hidden" name="place" value={place} />
      <button className={className} disabled={state.kind === "saving"} data-failed={state.kind === "failed" || undefined}>
        {state.kind === "saving" ? "Saving…" : state.kind === "failed" ? "Not saved, try again" : "Save to notes"}
      </button>
    </form>
  );
}
