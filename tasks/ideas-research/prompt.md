research.md above holds a few problems that small business owners in the UK and the US keep raising, each with its counts (worked out by code, so trust them), the posts behind it and, when it has one, the judge's verdict: six scores with their reasons and the few tools the judge's quick search named.

The reader is a software developer based in the UK who builds alone, with AI, looking for a problem to build a paid product for. Don't start from a business idea and argue for it. Research each problem the way a careful founder would before writing a line of code.

Work in three rounds of tool calls, each round one turn with every call for every problem in it (every turn sends everything again, so never one call a turn):

- Round 1, the market. Two to four searches per problem for products that solve it, worded from the chore and the trade, never from a product research.md names: "<the chore> software for <the trade>", "<the tool they use> <the missing feature>", "best <kind of tool> for small business UK". The judge's tools were a quick first look; this round is to find what it missed, the products these people would meet first.
- Round 2, the reviews. One search per product you will list: "<product> reviews" or "<product> reddit".
- Round 3, what users wrote. Open at least two pages per problem: the review pages or Reddit threads from round 2 that say most about what users like and dislike. Capterra, G2 and Trustpilot often refuse to be opened; pick an App Store or Google Play listing, a Reddit thread or another review site instead.

Then answer, per problem:

1. `approaches`: three ways to solve it, three different kinds of solution rather than three versions of one: say an add-on to a tool they already use, a standalone app for one trade, a done-for-you service run with automation, a template, a browser extension. Each one's `exists` names the products from your searches that already solve it that way.
2. `products`: up to five that solve it, the ones these people would most likely meet first, from your own searches. A tool the judge named belongs here only if your searches found it too; never list one you know only from research.md or from memory.
3. `share`: how big each one is. No free source gives market share, so estimate it from what you saw (review counts on Capterra, G2, Trustpilot, the App Store or Google Play, "used by N businesses" claims, pricing tiers, funding news), naming the signal and saying it is an estimate.
4. `does`, `who` and `price`: what it does about this problem, for whom, and what it costs, as its page or the search results show it.
5. `liked` and `disliked`: what its users praise and complain about, in their words where you can, and in `reviews` the pages you read. A competitor's blog post about a rival is not a review; prefer what users wrote. Never invent a review: say "No reviews found" when you found none.
6. `worth` and `worth_why`: whether one person should compete. True only when there is room: the products that exist are too dear, too complex, too general, or disliked for something the posts care about, and one person could build the alternative in weeks and reach these people. False when good, cheap tools already do it well, when it only goes away by replacing a big platform (an accounting suite, a bank, a marketplace), or when the evidence is thin. A crowded market is not a no by itself; a market whose users are happy is.
7. Only when `worth` is true, the better solution: `better_name` in a few plain words (not a brand name), `better_pitch` what it does and for whom, `better_edge` what it does better than the products you found, tied to what their users dislike and what the posts ask for, and `better_first` the first thing to do this week to find out whether people would pay. Leave all four "" when `worth` is false.

Every count and quote about the problem comes from research.md; every claim about a product comes from a page or a search result you saw. Plain words, no hype. Saying a problem is not worth competing on is a useful answer.

Give research for every problem in research.md. Deliver it by calling the StructuredOutput tool with it as the arguments (`research` an array, not a string). Don't write it or any JSON as text.
