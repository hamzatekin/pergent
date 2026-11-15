problems.md above lists the categories, then every problem found so far, each with its number. posts.md holds new posts about doing business between the UK and Turkey: Reddit posts that name Turkey, a Turkish city or Turkish firms, from subreddits of online sellers, clothing brands, manufacturing, freight and supply chain; every post of r/ihracat, where Turkish exporters write in Turkish; and Freelancer.com jobs, paid in dollars or pounds, that mention Turkey or Turkish. Each post has a ref (p1, p2…), where it came from and its date. Promotion and chatter were already filtered out, but not perfectly, and some posts name Turkey only in passing.

The reader is a software developer from Turkey, now working in the UK, who speaks Turkish and English, knows how people and firms in both countries work, and builds alone with AI. They are looking for a product UK businesses would pay for, built on that edge: a problem British firms, and the Turkish firms they work with, run into again and again when they buy from, make in, ship from or sell to Turkey. Your job is to sort the posts into problems so that the same problem raised by different people, in different words, ends up under one number and can be counted. You don't judge whether it would make a business; that comes later, from the counts.

For every post, decide which problem it raises:
- An existing problem when the post is about the same underlying problem, even in other words or about another product: "can't find a Turkish factory that will do 100 pieces" and "every manufacturer in Istanbul wants a 1,000 minimum" are the same problem. Use its number, like "17". Prefer an existing problem whenever one fits.
- A new problem when none fits: add it to `problems` with a key (n1, n2…) and point the post at the key. Several posts in this batch can share one new problem.
- "" when the post raises no problem to do with Turkey that software or a service could ease: a problem that has nothing to do with Turkey (it is one country in a list), one deal gone wrong with nothing others would share, news, politics, travel, chatter.

A question can raise a problem: "how do I check a Turkish supplier is real before I pay?" raises vetting suppliers. A job post raises the chore it pays for: someone paying $300 to find and contact Turkish towel makers raises finding suppliers.

A problem is specific enough that one product could solve it and general enough that different people's posts land on it. "Importing is hard" is too broad; "Duty charged on Turkish goods because the origin proof was missing" is fine; one person's one late parcel is too narrow. Name it in the words of the people who have it, not as a product, and in English even when the post is in Turkish. Pick its category from the list in problems.md; anything that fits none goes under the last one.

For each post that raises a problem, also say what it tells about it: `recurring`, `cost`, `workaround` and a short `quote` in the post's own language, each only from what the post says. Never add facts the post doesn't have.

Every post of posts.md goes in `posts` exactly once, by its ref, including the ones that raise no problem.

Deliver the sort by calling the StructuredOutput tool with it as the arguments (`problems` and `posts` arrays, not strings). Don't write the sort or any JSON as text.
