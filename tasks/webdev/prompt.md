The two files above, each in a `<file>` tag, are your sources.

- newsletters.md: every issue since the last weekly digest of the newsletters I subscribe to, as full text with links. JavaScript Weekly, Frontend Focus, React Status and Node Weekly are weekly and about web development; NativeWeekly (by Adnan Sahinovic) is about React Native and Expo; The Deep View, Superpower Daily and MyClaw Newsletter are daily and about AI. Each item's link is in parentheses after its title.
- previous.md: the headlines and links of last week's digest. Don't run any of them again unless something actually changed, and then write about the new part only.

You are writing my weekly reading digest. I am a frontend-focused full-stack software engineer who also builds with React Native and Expo. I want to read it in about five minutes and know what mattered this week, without opening the newsletters.

How to work:

1. Go through every issue and pull out the editorial items: articles, tutorials, releases, news. Ignore sponsors, "in partnership with", classifieds, job ads, events, polls, unsubscribe and referral links, and anything that reads like an advertisement. When several newsletters cover the same story, it is one story: pick the best link (the original article, the release notes or the repo, not another newsletter's page) and say it was widely covered if that's telling.
2. Rank what is left for me. High: modern HTML and CSS, JavaScript and TypeScript, React, React Native and Expo, Node.js, browser and mobile APIs, performance, accessibility, tooling, web standards, security, AI-assisted development and coding agents, major AI model and tool releases, AI research that changes how software is built, important ecosystem changes. Technically useful React Native and Expo items from NativeWeekly rank relatively high. Low: AI business news, funding, hype, opinion pieces about AI and society, consumer AI gadgets. Prefer technical and actionable over generic.
3. Read the originals. Pick the 6 to 8 strongest candidates for the top of the digest and open their links with `WebFetch`, all in one step (all the `WebFetch` calls together in a single turn), then don't fetch again. Write those stories from what the article actually says, not from the newsletter blurb. Don't pick x.com links (they don't open) or shortened links (bit.ly and the like), and don't retry or chase a link that redirects or fails. If a page needs a subscription or a login, or fails to load, say so in the story ("Paywalled, summary from the newsletter" or "Couldn't open the article, summary from the newsletter") rather than guessing at what it says.

You hand the digest over as structured output, a paper: a `title`, then `sections`, each with a `heading` and its `stories`. Every story has a `headline` (one line, plain words, one emoji at the start), a `body` (markdown), a `source` (the article's own URL, copied from newsletters.md) and an `importance`. Every story needs a `source`; an item with no link of its own in newsletters.md is left out.

`title`: "🧑‍💻 Web dev weekly, <date>", the date written out like "October 18, 2026".

Sections, in this order:

"⭐ Must read": about five items overall, the most useful of the week across web, mobile and AI. The first one or two get `importance` 3, the rest 2. Each `body` is markdown with these parts, each on its own line, separated by blank lines:
- a 2 to 4 sentence summary of what the article says;
- **Why it matters:** one or two sentences, for me specifically;
- **Takeaway:** the key technical point, the thing to remember or try;
- **Read it fully?** Yes or No, with a few words why (for example "Yes, the benchmarks are worth seeing" or "No, the summary covers it"), or the note that it was paywalled or wouldn't open.

"🌐 Web & mobile": the next items worth knowing about frontend, React, React Native, Expo, Node, CSS, browsers, tooling. "🤖 AI & software engineering": the next items worth knowing about coding agents, AI tools and models, and how software gets built. Together these two sections hold about five items, `importance` 2, each a `body` of one to three sentences: what it is and why it's worth knowing. Then, in either section, `importance` 1 briefs for anything else genuinely useful: a release, a library, a tool, a good tutorial, one sentence each. Keep briefs to about ten across both sections; this is a five-minute read, not a full index. Leave out a section that has nothing.

"🗑️ Skipped": only when there is a useful reason, for example a big story everyone covered that isn't worth my time, or a newsletter that had no issue this week. Its `lead` is a short markdown list, one line each, and `stories` is an empty list, `[]`. Leave the section out otherwise.

If newsletters.md has no new issues, the paper is one section with one story saying so.

Write plainly, like explaining to a smart colleague. Short sentences. If a term needs it, add a few words saying what it means. Leave out `context` unless a story makes no sense without background.

Deliver the paper by calling the StructuredOutput tool with it as the arguments (`sections` an array, not a string). Don't write the paper or any JSON as text.
