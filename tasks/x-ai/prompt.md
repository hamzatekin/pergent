Five files are in the working directory. Read all five before writing anything.

- tweets.md: posts from the last 24 hours by AI accounts, grouped by category: labs, AI coding tools, agent builders, open-source infra, researchers, founders.
- tweets-web.md: posts from the last 24 hours by hand-picked web dev accounts: frameworks, runtimes, databases, and well-known frontend and backend people.
- discourse.md: the most discussed and trending posts across tech Twitter from a curated aggregator, ranked by replies. This is where the arguments are.
- hn.md: the Hacker News front page plus every story with big points in the last 24 hours. Best source for backend, infrastructure, architecture, and security stories.
- newsletters.md: new issues of newsletters I subscribe to (JavaScript Weekly, Frontend Focus, React Status, Node Weekly, The Deep View), as full text with links. They're weekly or daily, so on many days this file says there are no new issues. When there are, they're human-curated and high signal.

You are writing a morning digest for one person: a web developer who also follows AI closely. Make it fun to read. Plain, simple language, like explaining to a smart friend over coffee. Short sentences. If you must use a technical term, add a few words saying what it means. Use emojis in section headings and in each item's heading to set the mood. Don't overdo it: one emoji per item, never mid-sentence.

The reader doesn't follow every thread day to day. When an item is about something that needs background to make sense (a project, a benchmark, an argument that has been running for a while, a technique with a name, a company or person the reader may not know), add a "Context" block under the item: two or three plain sentences on what the thing is and why it came up. Only when it's needed; skip it for self-explanatory items. Don't guess: if you don't know the background and the files don't say, leave the block out.

Structure:

# ☕ Tech digest for <date>

## ⚡ TL;DR
3 to 5 bullets, one line each, covering the biggest things across all files. No links here. This is the only section that uses bullets instead of "### " items.

## 🚀 Big announcements
Model releases, new products and features, pricing changes, open-source drops. Mostly from tweets.md and hn.md. Skip marketing fluff, reposts of praise, hiring posts, event reminders.

## 🔥 What people are fighting about
The 3 to 6 topics with the most heat, from any file. High reply counts relative to likes or points signal a fight. For each: what the claim is, who is pushing back and on what grounds if visible, and why anyone should care. Don't just restate the post.

## 🧑‍💻 Web dev corner
Frontend, backend, databases, infrastructure, architecture. Framework releases, hot takes about how to build things, tooling changes, performance and security stories. Pull from all files.

## 📬 From the newsletters
Only when newsletters.md has new issues. Pick the 3 to 8 things across all issues that are worth my time; don't re-summarize whole issues. Skip sponsored items, job ads, and anything already covered above. Link to the article itself, not the issue.

## 🧪 Research & open source
Papers, benchmarks, notable repos.

## 🍿 Worth a read
Sharp takes, good essays, and stories that don't fit above.

Each item is its own "### " section, in exactly this shape:

### 🧩 One-line headline in plain words
One or two sentences of substance.

> **Context:** Only when needed, two or three sentences of background.

https://the-source-link

Every item must end with a link copied from the files (the x.com post, the article URL, or the HN discussion). An item without a link is a bug. Merge threads and duplicate coverage of the same thing into one item; if a story appears in more than one file, mention it once and say it was everywhere. Omit a section if it has nothing. If nothing meaningful happened, say so in one line under the title.

Start your final message with the "# " title line. No sentence before the title. End with the last item: no closing line, no sign-off, no attribution or co-author line.
