The file above, in a `<file>` tag, is foryou.md: the best posts of the last 24 hours from the accounts the reader follows on X, already ranked by a script, best first. Each post has its author, its numbers (likes, bookmarks, reposts, replies, and what that author usually gets), which followed accounts reposted it, its text, any post it quotes, and its URL.

You are laying out the reader's own For You feed. The ranking is done: your job is to make the posts quick to read, not to judge them again. The reader follows a mix of Turkish and English accounts (Turkish politics and news, tech and AI, sport, jokes and memes) and reads both languages. Write in English, and translate Turkish posts faithfully. Plain, short sentences.

You hand it over as structured output, a paper: a `title`, then `sections`, each with a `heading` and its `stories`. One story is one post.

- `headline`: one line saying what the post is, starting with one emoji and the author, like "📉 @someone: the lira hit a new low".
- `body`: what the post says, in one or two sentences, close to the author's own words. Quote a short line when the wording is the point (a joke, a sharp take). When it quotes another post, say what it is replying to. Don't add opinions of your own or facts the post doesn't have.
- `context`: only when the post makes no sense without background you are sure of (who a person is, what an ongoing story is). Two sentences at most, facts only: never guess at motives or what something suggests. Leave it out otherwise.
- `source`: the post's URL, exactly as in the file. Every story must have one.
- `importance`: 3 for the top two or three posts of the whole feed (put each in its section), 2 for the rest of the top 40 or so, 1 for everything below that. A 1 is a one-line brief: its body is one sentence.

`title`: "For you, <date>", the date written out like "September 26, 2026".

Sections: group the posts by topic, in 4 to 7 sections you name yourself from what is there (for example "🇹🇷 Turkey", "🤖 Tech & AI", "⚽ Sport", "🌍 World", "😂 Funny"), with an emoji at the start of each heading. Order the sections by their best post, and keep the file's order inside a section. When several posts are about the same event (the same scandal, match, launch or meme), make them one story: the best ranked post is its `source`, the body says what it adds, and one more sentence says who else posted about it and what they added. A feed that shows the same event six times is the thing to avoid, but so is a short one: merge only posts about the very same event, never posts that merely share a topic. Every other post stays its own story, so expect 80 to 120 stories from 150 posts.

Keep every post in the file, merged as above: nothing is dropped, the small ones become briefs. Leave out only a post that is an ad, a giveaway or a hiring post.

Deliver the paper by calling the StructuredOutput tool with it as the arguments (`sections` an array, not a string). Don't write the paper or any JSON as text.
