import { useLocation, useRouter } from "@tanstack/react-router";
import type { FormEvent } from "react";
import { layoutCookie, type Layout } from "../layout.ts";
import { Icon } from "./Icon.tsx";

// The switch between the columns, the rows and the printed newspaper, for a task that has both. A form posting to
// /layout, so it works before the page hydrates; once it has, the click sets the cookie here and the
// page reloads its data in place.
export function LayoutToggle({ task, current }: { task: string; current: Layout }) {
  const router = useRouter();
  const { pathname } = useLocation();
  const choose = (e: FormEvent<HTMLFormElement>) => {
    const layout = ((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value as Layout | undefined;
    if (!layout) return;
    e.preventDefault();
    if (layout === current) return;
    // biome-ignore lint/suspicious/noDocumentCookie: the reader's layout is stored in their browser only, never sent to the server.
    document.cookie = layoutCookie(task, layout);
    router.invalidate().then(() => scrollTo({ top: 0 }));
  };
  return (
    <form className="layouts" method="post" action="/layout" onSubmit={choose}>
      <input type="hidden" name="task" value={task} />
      <input type="hidden" name="next" value={pathname} />
      <button type="submit" name="layout" value="cards" aria-pressed={current === "cards"} aria-label="Columns" title="Columns">
        <Icon name="grid" />
      </button>
      <button type="submit" name="layout" value="rows" aria-pressed={current === "rows"} aria-label="Rows" title="Rows">
        <Icon name="rows" />
      </button>
      <button type="submit" name="layout" value="newspaper" aria-pressed={current === "newspaper"} aria-label="Newspaper" title="Newspaper">
        <Icon name="newspaper" />
      </button>
    </form>
  );
}
