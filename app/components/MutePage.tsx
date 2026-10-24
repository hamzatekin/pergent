// The never-show page: the story with one button per suggestion (when it came from a story's link), a
// field for anything else, such as a product, and the list with an Undo per phrase. The forms post to
// /admin/mutes and /admin/mutes/remove.
type Data = { task: string; back: string; muted: string[]; story?: { headline: string; source?: string; picks: { phrase: string; label: string }[] } };

export function MutePage({ data }: { data: Data }) {
  const { task, back, story, muted } = data;
  const hidden = (
    <>
      <input type="hidden" name="task" value={task} />
      <input type="hidden" name="back" value={back} />
    </>
  );
  return (
    <>
      <h1 className="admin-title">Never show in {task}</h1>
      {story && (
        <>
          <div className="mute-story">
            <p className="mute-headline">{story.headline}</p>
            {story.source && (
              <p className="note">
                <a href={story.source} target="_blank" rel="noopener">
                  {story.source}
                </a>
              </p>
            )}
          </div>
          <form method="post" action="/admin/mutes" className="mute-picks">
            {hidden}
            {story.picks.map((p) => (
              <button key={p.phrase} type="submit" name="phrase" value={p.phrase} className="btn">
                {p.label}
              </button>
            ))}
          </form>
        </>
      )}
      <form method="post" action="/admin/mutes" className="mute-add">
        {hidden}
        <input name="phrase" placeholder="Or type a name or a few words" required minLength={2} maxLength={200} autoFocus={!story} />
        <button type="submit" className="btn">
          Never show
        </button>
      </form>
      <p className="note">
        Posts that mention a muted name are set aside before the sort, problems that mention it are hidden from the board, and stories that mention it are hidden, in
        old papers too. A headline stands for pains like it.
      </p>
      <h2 className="admin-head">Muted ({muted.length})</h2>
      {muted.length ? (
        <ul className="mutes">
          {muted.map((p) => (
            <li key={p}>
              <span>{p}</span>
              <form method="post" action="/admin/mutes/remove">
                {hidden}
                <input type="hidden" name="phrase" value={p} />
                <button type="submit" className="linkbtn">
                  Undo
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p className="note">Nothing muted yet.</p>
      )}
      <p className="note">
        <a href={back}>Back</a>
      </p>
    </>
  );
}
