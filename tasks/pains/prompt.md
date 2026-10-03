The file pains.md above holds what small business owners in the UK and the US said in the last few days, and what they are paying others to do, grouped by where it came from:
- Reddit: posts from subreddits where owners talk shop (landlords, trades, shops, ecommerce sellers, accountants, restaurants, services), plus a week of posts anywhere in them that ask for a tool, mention a spreadsheet or doing things by hand.
- Forums: the Shopify Community, Square's seller community (its "product ideas" board is sellers asking for what Square doesn't do), and MoneySavingExpert's small business and tax boards (UK).
- Reviews: new 1 and 2 star reviews of the apps businesses pay for, from Apple's App Store (QuickBooks, Square, Shopify, Jobber, Vagaro…) and the Shopify App Store. A review says what a paid tool fails at, and that its user is still looking.
- Job posts from Freelancer.com: people paying someone to do work, with the budget. A post paying someone to do a chore by hand every week (bookkeeping, data entry, reconciling, copying between systems) is the plainest proof that the chore is worth money.

Each item has its date, sometimes who posted it (for a review: the country and app version, or the store; for a job: the budget), its title, its text and its URL. Promotion, one-off build jobs and chatter were already filtered out, but not perfectly. previous.md lists the pains from this task's papers of the last two weeks.

The reader is a software developer looking for a problem to build a paid product for: a problem that comes back every week or month, that costs the people who have it time or money, and that they would keep paying to be rid of. They are not looking for developer tools. Your job is to pull those problems out of the posts, not to invent products.

You hand it over as structured output, a paper: a `title`, then `sections`, each with a `heading` and its `stories`. One story is one pain.

What counts as a pain, strongest first:
- the same problem raised by several people, in several places, or again after appearing in previous.md;
- a task done by hand every week or month (reconciling, chasing, copying between systems, filling forms);
- money or hours named ("costs me £200 a month", "takes my Sunday");
- a workaround already in place: spreadsheets, a VA, three tools taped together, or a job post paying someone to do it (give the budget);
- anger at a tool they already pay for, or a new rule or deadline they have to meet.

What does not: one-off questions about starting out, legal questions for one situation, a consumer's personal tax or money question, requests for feedback on a store, venting about one customer, a bug in one app that its maker will fix, and anything only a developer would feel.

For each story:
- `headline`: the pain in one plain line, in the words of the people who have it, like "Landlords re-typing rent payments into MTD software every quarter". Not a product name.
- `body`: who has it, what they do today and what it costs them, in two to four sentences. Quote a short phrase from a post when the wording shows how much it hurts. When several posts raise it, say how many and where ("three posts in r/UKLandlords, two QuickBooks reviews and a Freelancer job at $15 an hour"). Never add facts the posts don't have.
- `context`: only for importance 3 and 2: one or two sentences on why someone might pay to have it solved (how often it recurs, what they already spend, who the buyer is), each claim traceable to a post. Leave it out when the posts don't show it.
- `source`: the URL of the post that shows the pain best, exactly as in the file. Every story must have one.
- `importance`: 3 for the one or two strongest pains of the whole paper (recurring, costly, raised more than once or seen again from previous.md), 2 for a clear pain from one post, 1 for a weaker hint worth a line: a brief, whose body is one sentence.

A pain that is in previous.md and turns up again is the most useful thing in the paper, the opposite of news: keep it, start its body with "Seen again:" and say what the new post adds. Pains in previous.md that did not come up again are left out.

`title`: "Pains, <date>", the date written out like "September 27, 2026".

Sections: group the pains by who has them, 4 to 8 sections you name yourself from what is there (for example "🏠 Landlords & property", "🛒 Ecommerce & Shopify", "🧾 Accounting & tax", "🔧 Trades & services", "🍽️ Restaurants"), with an emoji at the start of each heading, strongest section first. Merge posts about the same pain into one story, from whichever sources it came. Leave out items that aren't pains. Expect 20 to 35 stories on a normal day: the clear pains as stories, the weaker hints as briefs rather than dropped.

Deliver the paper by calling the StructuredOutput tool with it as the arguments (`sections` an array, not a string). Don't write the paper or any JSON as text.
