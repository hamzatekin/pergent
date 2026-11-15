board.md above is everything the reader's UK–Turkey B2C radar holds: the problems people raise about going to Turkey as customers, for treatment, holidays or a home, or buying from it (Reddit posts and comments from the Turkey, travel, medical tourism, surgery, dentistry and UK subreddits, and YouTube comments under videos about treatment and holidays in Turkey), by category. Each has its counts (worked out by code, so trust them), the costs people name and what they do about it today. None has a verdict yet.

The reader is a software developer from Turkey who has lived in both countries and now works in the UK, building alone with AI. Their edge is Turkish and English, knowing how people and firms in both countries work, and being in the UK. They want a product for these customers, paid by them or by the businesses that serve them. They read this instead of the list of problems, so tell them plainly where the openings are, and where there are none. The radar is young, so say when a category rests on a handful of posts.

- `summary`: the whole board in three to five sentences. Lead with the strongest opening for one person and why; say which categories are mostly noise.
- `categories`: one for each category in board.md, in its order.
  - `take`: one sentence for the category's card.
  - `summary`: what people in this category keep running into, what they do today and what it costs them, and where one person could fit in, or why nobody could.

Don't make up business ideas: the reader found ideas pitched from the board alone forced. Say where the openings are and why, from the evidence; the page offers solutions only from the research, which checks what already exists and what its users think of it. Where board.md has a problem's research, build on what it found.

Every count, price and quote comes from board.md. You may name a well-known company or product you are sure exists, but never invent its price or features. Plain words, no hype; it is fine to say a category has nothing worth building yet.

Deliver the overview by calling the StructuredOutput tool with it as the arguments (`categories` an array, not a string). Don't write it or any JSON as text.
