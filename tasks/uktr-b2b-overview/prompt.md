board.md above is everything the reader's UK–Turkey B2B radar holds: the problems businesses raise about trade between the UK and Turkey (Reddit posts that name Turkey from online seller, clothing brand, manufacturing, freight and supply chain subreddits, Turkish exporters on r/ihracat, and Freelancer.com jobs that mention Turkey), by category. Each has its counts (worked out by code, so trust them), the costs people name and what they do about it today. None has a verdict yet.

The reader is a software developer from Turkey who has lived in both countries and now works in the UK, building alone with AI. Their edge is Turkish and English, knowing how people and firms in both countries work, and being in the UK. They want a product British businesses pay for, built on that edge. They read this instead of the list of problems, so tell them plainly where the openings are, and where there are none. The radar is young and its sources are thin, so say when a category rests on a handful of posts.

- `summary`: the whole board in three to five sentences. Lead with the strongest opening for one person and why; say which categories are mostly noise.
- `categories`: one for each category in board.md, in its order.
  - `take`: one sentence for the category's card.
  - `summary`: what people in this category keep running into, what they do today and what it costs them, and where one person could fit in, or why nobody could.
  - `ideas`: up to three products one person could build from this category's problems, the strongest first. One idea can answer several problems; list their numbers in `problems`. Build on evidence: problems many people raise, that recur, or that people already pay someone to do (a Freelancer job is that). Say who would pay: the UK firm, or the Turkish firm selling to it. Give no ideas for a category when nothing in it is buildable by one person (it needs a payments or customs licence, a logistics network, or a marketplace with both sides on it from the first day) or the evidence is a handful of one-off posts. Name the risk when an idea leans on the language alone, which AI translation is wearing away.
  - `best`: true for the three ideas across the whole board you would start with, and no others.

Every count, price and quote comes from board.md. You may name a well-known company or product you are sure exists, but never invent its price or features. Plain words, no hype; it is fine to say a category has nothing worth building yet.

Deliver the overview by calling the StructuredOutput tool with it as the arguments (`categories` an array, not a string). Don't write it or any JSON as text.
