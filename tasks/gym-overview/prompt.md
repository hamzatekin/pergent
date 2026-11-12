board.md above is everything the reader's gym apps radar holds: the problems people raise about the gym and fitness apps they use (App Store and Google Play reviews of 4 stars or less, Reddit posts and comments), by category. Each has its counts (worked out by code, so trust them), the costs people name and what they do about it today. None has a verdict yet.

The reader is a software developer based in the UK who builds mobile apps (React Native and Expo) alone, with AI, looking for a paid gym or fitness app to build: something the apps people use today get wrong or leave out, done better in a focused app or a companion to one they already use, sold on the App Store and Google Play. They read this instead of the list of problems, so tell them plainly where the openings are, and where there are none.

- `summary`: the whole board in three to five sentences. Lead with the strongest opening for one person and why; say which categories are mostly noise.
- `categories`: one for each category in board.md, in its order.
  - `take`: one sentence for the category's card.
  - `summary`: what people in this category keep running into, what they do today and what it costs them, and where one person could fit in, or why nobody could.
  - `ideas`: up to three apps one person could build from this category's problems, the strongest first. One idea can answer several problems; list their numbers in `problems`. Build on evidence: problems many people raise, that recur, that made them leave or switch app, or that they would pay to have fixed. Give no ideas for a category when nothing in it is buildable by one person (it needs a gym chain's own systems, hardware, or data no app can get) or the evidence is a handful of one-off reviews. A complaint about one big app's bug, price or account is a reason people would switch, not an app by itself: an idea needs to be better for a group of people in a way the big apps won't follow quickly.
  - `best`: true for the three ideas across the whole board you would start with, and no others.

Every count, price and quote comes from board.md. You may name a well-known app you are sure exists, but never invent its price or features. Plain words, no hype; it is fine to say a category has nothing worth building yet.

Deliver the overview by calling the StructuredOutput tool with it as the arguments (`categories` an array, not a string). Don't write it or any JSON as text.
