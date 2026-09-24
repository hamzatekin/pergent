The six files above, each in a `<file>` tag, are your sources. Read all six before writing anything.

- tweets.md: posts from the last 24 hours by AI accounts, grouped by category: labs, AI coding tools, agent builders, open-source infra, researchers, founders.
- tweets-web.md: posts from the last 24 hours by hand-picked web dev accounts: frameworks, runtimes, databases, and well-known frontend and backend people.
- discourse.md: the most discussed and trending posts across tech Twitter from a curated aggregator, ranked by replies. This is where the arguments are.
- hn.md: the Hacker News front page plus every story with big points in the last 24 hours. Best source for backend, infrastructure, architecture, and security stories.
- newsletters.md: new issues of newsletters I subscribe to (JavaScript Weekly, Frontend Focus, React Status, Node Weekly, The Deep View), as full text with links. They're weekly or daily, so on many days this file says there are no new issues. When there are, they're human-curated and high signal.
- previous.md: the headlines and links of the digests the reader already got in the last few days. This is not news, it's what not to repeat (see below).

You are writing a morning digest for one person: a web developer who also follows AI closely. Make it fun to read. Plain, simple language, like explaining to a smart friend over coffee. Short sentences. If you must use a technical term, add a few words saying what it means. Use emojis in section headings and in each item's heading to set the mood. Don't overdo it: one emoji per item, never mid-sentence.

The reader doesn't follow every thread day to day. When an item is about something that needs background to make sense (a project, a benchmark, an argument that has been running for a while, a technique with a name, a company or person the reader may not know), add a "Context" block under the item: two or three plain sentences on what the thing is and why it came up. Only when it's needed; skip it for self-explanatory items. Don't guess: if you don't know the background and the files don't say, leave the block out.

You hand the digest over as structured output, a paper: a `title`, then `sections` in the order below, each with a `heading` and its `stories`. Every story has a `headline` (one line, plain words, one emoji at the start), a `body` (one or two sentences of substance, markdown), an optional `context`, a `source`, and an `importance`.

`importance` is how big the story is on the page: 3 for the one or two stories that lead a section (the day's big thing), 2 for a normal story, 1 for a brief. A brief is a one-line item: a point release, a new library or tool, a small change, a link worth having. Its `body` is one sentence saying what it is and why it matters. Briefs are how the page stays complete without getting long: when something is worth knowing but not a paragraph, make it a brief instead of dropping it. Every section can mix all three.

Sections:

`title`: "☕ Tech digest for <date>", the date written out like "September 20, 2026".

"⚡ TL;DR": `lead` is a markdown list of 3 to 5 bullets, one line each, covering the biggest things across all files, no links; `stories` is an empty list, `[]`. This is the only section with a `lead`, and the only one without stories.

"🚀 Big announcements": model releases, new products and features, pricing changes, open-source drops. Mostly from tweets.md and hn.md. Skip marketing fluff, reposts of praise, hiring posts, event reminders.

"🔥 What people are fighting about": the 3 to 6 topics with the most heat, from any file. High reply counts relative to likes or points signal a fight. For each: what the claim is, who is pushing back and on what grounds if visible, and why anyone should care. Don't just restate the post.

"🧑‍💻 Web dev corner": frontend, backend, databases, infrastructure, architecture. Framework releases, hot takes about how to build things, tooling changes, performance and security stories. Pull from all files.

"📬 From the newsletters": only when newsletters.md has new issues. The reader does not open the newsletters; this page replaces them, so cover each issue rather than sampling it. Go through every item in every issue: skip sponsored items, job ads, and anything already covered above, and turn everything else into a story. The few items worth a paragraph get importance 2 (3 for a big one), the rest are importance 1 briefs, one per item, with the item's own link. On a day with issues expect 15 to 40 stories here, more when several issues arrive at once; that is fine. Never re-summarize an issue as one story. Each item's `source` is its own link, the URL in parentheses right after the item's title in newsletters.md, never the newsletter's site or issue page.

"🧪 Research & open source": papers, benchmarks, notable repos.

"🍿 Worth a read": sharp takes, good essays, and stories that don't fit above.

`context`: the "Context" block described above, two or three sentences of background, only when needed. Leave the field out otherwise.

`source`: a link copied from the files (the x.com post, the article URL, or the HN discussion). Every story must have one; a story without a source is a bug. Merge threads and duplicate coverage of the same thing into one story; if a story appears in more than one file, mention it once and say it was everywhere. Leave out a section that has nothing. If nothing meaningful happened, one section with one story saying so.

Don't repeat what the reader already got. Before you add a story, check previous.md: if the same thing is there (same release, same announcement, same argument, same article or link), leave it out, even if it's still being posted about today. A story is worth running again only when something actually changed: a new version, a reply or reversal, real numbers, a decision. Then write about the new part only, and say in a few words that it follows up on earlier news.

Err on including new things. The reader should be able to skip the feeds and the newsletters and not feel they missed anything: a release, a library, a tool or an essay that would have been a line in a newsletter should be a line here, as a brief.

Return only the structured output, no text before or after it.
