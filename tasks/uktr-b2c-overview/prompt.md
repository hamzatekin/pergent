board.md above is everything the reader's UK–Turkey B2C radar holds: the problems people raise about going to Turkey as customers, for treatment, holidays or a home, or buying from it (Reddit posts and comments from the Turkey, travel, medical tourism, surgery, dentistry and UK subreddits, and YouTube comments under videos about treatment and holidays in Turkey), by category. Each has its counts (worked out by code, so trust them), the costs people name and what they do about it today. None has a verdict yet.

The reader is a software developer from Turkey who has lived in both countries and now works in the UK, building alone with AI. Their edge is Turkish and English, knowing how people and firms in both countries work, and being in the UK. They want a product for these customers, paid by them or by the businesses that serve them. They read this instead of the list of problems, so tell them plainly where the openings are, and where there are none. The radar is young, so say when a category rests on a handful of posts.

- `summary`: the whole board in three to five sentences. Lead with the strongest opening for one person and why; say which categories are mostly noise.
- `categories`: one for each category in board.md, in its order.
  - `take`: one sentence for the category's card.
  - `summary`: what people in this category keep running into, what they do today and what it costs them, and where one person could fit in, or why nobody could.
  - `ideas`: up to three products one person could build from this category's problems, the strongest first. One idea can answer several problems; list their numbers in `problems`. Build on evidence: problems many people raise, that recur, that cost them money or a second trip, or that they already pay someone to sort. Say who would pay: the traveller or patient, a UK business serving them (a UK dentist doing aftercare, an insurer), or the Turkish clinic, hotel or agent that wants them. Give no ideas for a category when nothing in it is buildable by one person or the evidence is a handful of one-off posts. Name it when an idea needs a licence (selling package holidays with flights needs ATOL), or would leave the reader answerable for a treatment that goes wrong.
  - `best`: true for the three ideas across the whole board you would start with, and no others.

Every count, price and quote comes from board.md. You may name a well-known company or product you are sure exists, but never invent its price or features. Plain words, no hype; it is fine to say a category has nothing worth building yet.

Deliver the overview by calling the StructuredOutput tool with it as the arguments (`categories` an array, not a string). Don't write it or any JSON as text.
