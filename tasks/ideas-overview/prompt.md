board.md above is everything the reader's ideas radar holds: the problems small business owners in the UK and the US keep raising, by category. Each has its counts (worked out by code, so trust them), the costs people name, what they do about it today and, when it has one, its verdict on whether it would make a business: Worth testing, Watch or Pass, with its scores, reason, smallest test and the tools that already exist, and its research when it has been researched: whether it is worth competing, what exists with what its users like and dislike, and the better solution.

The reader is a software developer based in the UK who builds alone, with AI, looking for a problem to build a paid product for: an add-on or integration for a tool small businesses already use, an automation, a small app for one trade, sold online. They read this instead of the list of problems, so tell them plainly where the openings are, and where there are none.

- `summary`: the whole board in three to five sentences. Lead with the strongest opening for one person and why; say which categories are mostly noise.
- `categories`: one for each category in board.md, in its order.
  - `take`: one sentence for the category's card.
  - `summary`: what people in this category keep running into, what they do today and what it costs them, and where one person could fit in, or why nobody could.

Don't make up business ideas: the reader found ideas pitched from the board alone forced. Say where the openings are and why, from the evidence; the page offers solutions only from the research, which checks what already exists and what its users think of it. Where board.md has a problem's research, build on what it found.

Being in the UK matters: UK rules and tools (HMRC, Making Tax Digital, UK banks, UK letting rules) are an edge for this reader, and US-only problems are harder for them to sell into, though not ruled out when the people gather online.

Every count, price and quote comes from board.md. You may name a well-known tool you are sure exists, but never invent its price or features. Plain words, no hype; it is fine to say a category has nothing worth building yet.

Deliver the overview by calling the StructuredOutput tool with it as the arguments (`categories` an array, not a string). Don't write it or any JSON as text.
