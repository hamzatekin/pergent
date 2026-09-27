The file pains.md above holds what small business owners in the UK and the US posted in the last two days: new posts from subreddits where they talk shop (landlords, trades, shops, ecommerce sellers, accountants, restaurants), new topics from the Shopify Community forum, and new 1 and 2 star reviews of paid Shopify apps. Each item has its date, sometimes who posted it (for a review: the store, its country and how long it used the app), its title, its text and its URL. Promotion and chatter were already filtered out, but not perfectly. previous.md lists the pains from this task's papers of the last two weeks.

The reader is a software developer looking for a problem to build a paid product for: a problem that comes back every week or month, that costs the people who have it time or money, and that they would keep paying to be rid of. They are not looking for developer tools. Your job is to pull those problems out of the posts, not to invent products.

You hand it over as structured output, a paper: a `title`, then `sections`, each with a `heading` and its `stories`. One story is one pain.

What counts as a pain, strongest first:
- the same problem raised by several people, in several places, or again after appearing in previous.md;
- a task done by hand every week or month (reconciling, chasing, copying between systems, filling forms);
- money or hours named ("costs me £200 a month", "takes my Sunday");
- a workaround already in place: spreadsheets, a VA, three tools taped together;
- anger at a tool they already pay for, or a new rule or deadline they have to meet.

What does not: one-off questions about starting out, legal questions for one situation, requests for feedback on a store, venting about one customer, and anything only a developer would feel.

For each story:
- `headline`: the pain in one plain line, in the words of the people who have it, like "Landlords re-typing rent payments into MTD software every quarter". Not a product name.
- `body`: who has it, what they do today and what it costs them, in two to four sentences. Quote a short phrase from a post when the wording shows how much it hurts. When several posts raise it, say how many and where ("three posts in r/UKLandlords and one Shopify forum topic"). Never add facts the posts don't have.
- `context`: only for importance 3 and 2: one or two sentences on why someone might pay to have it solved (how often it recurs, what they already spend, who the buyer is), each claim traceable to a post. Leave it out when the posts don't show it.
- `source`: the URL of the post that shows the pain best, exactly as in the file. Every story must have one.
- `importance`: 3 for the one or two strongest pains of the whole paper (recurring, costly, raised more than once or seen again from previous.md), 2 for a clear pain from one post, 1 for a weaker hint worth a line: a brief, whose body is one sentence.

A pain that is in previous.md and turns up again is the most useful thing in the paper, the opposite of news: keep it, start its body with "Seen again:" and say what the new post adds. Pains in previous.md that did not come up again are left out.

`title`: "Pains, <date>", the date written out like "September 27, 2026".

Sections: group the pains by who has them, 3 to 6 sections you name yourself from what is there (for example "🏠 Landlords & property", "🛒 Ecommerce & Shopify", "🧾 Accounting & tax", "🔧 Trades & services", "🍽️ Restaurants"), with an emoji at the start of each heading, strongest section first. Merge posts about the same pain into one story. Leave out items that aren't pains. A thin day is fine: 10 good pains beat 40 weak ones.

Deliver the paper by calling the StructuredOutput tool with it as the arguments (`sections` an array, not a string). Don't write the paper or any JSON as text.
