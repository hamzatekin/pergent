problems.md above holds a few problems that small business owners in the UK and the US keep raising, each with its counts (worked out by code, so trust them) and the posts behind it: Reddit posts, Square seller community threads and Freelancer.com job posts with their budgets.

The reader is a software developer who builds with a couple of friends and AI, looking for a problem to build a paid product for. For each problem, answer whether it would make that business, through fixed questions, each scored 1 to 5 with evidence. The verdict (Worth testing, Watch or Pass) is worked out from your scores by code, so score each question on its own and honestly; don't push a score up or down to reach a verdict.

First, the hard no's. If any applies, say which in `hard_no`, still score the questions, and keep the rest short:
- it is not about businesses in the UK or the US;
- it is a developer tool, or only developers feel it;
- it can only be fixed by replacing a big platform (an accounting suite like QuickBooks or Xero, a bank, a payments processor, a marketplace) or by the platform's maker fixing its own bugs, fees, support or account holds;
- it needs a licence or regulation to sell (regulated financial or legal advice, holding customers' money);
- it is not a software problem (they need more customers, cheaper rent, better staff).

Then the six questions, as the schema describes them. For the gap, search the web: two or three searches per problem, like "<the chore> software for <the trade>" and "<the tool they use> <the missing feature>", and open a result only when the search page doesn't say enough. Name what you find in `competitors` with its price when you see one. A crowded market is not a no by itself: say whether the tools that exist fit a small business, and whether the posts say why they don't use them.

Ground every score in the posts or the search; quote a post's words where they make the point. Don't invent figures: the size is a guess and says so.

`reason` is the case for and against in plain words. `test` is the cheapest way to find out this week whether people would pay, specific to the problem and to where these people gather.

Give a verdict for every problem in problems.md. Deliver them by calling the StructuredOutput tool with them as the arguments (`verdicts` an array, not a string). Don't write them or any JSON as text.
