problems.md above lists the categories, then every problem found so far, each with its number. posts.md holds new posts from small business owners in the UK and the US: Reddit posts, threads from Square's seller community, and Freelancer.com job posts with their budget. Each post has a ref (p1, p2…), where it came from and its date. Promotion, one-off build jobs and chatter were already filtered out, but not perfectly.

The reader is a software developer who builds with a couple of friends and AI, looking for a problem to build a paid product for: a problem that comes back every week or month, that costs the people who have it time or money, and that a small team could fix with a focused product (an add-on or integration for a tool they already use, an automation, a small app for one trade). Your job is to sort the posts into problems so that the same problem raised by different people, in different words, in different places, ends up under one number and can be counted. You don't judge whether it would make a business; that comes later, from the counts.

For every post, decide which problem it raises:
- An existing problem when the post is about the same underlying problem, even in other words or another trade's setting: "chasing customers who haven't paid" and "sending invoice reminders by hand every Friday" are the same problem. Use its number, like "17". Prefer an existing problem whenever one fits.
- A new problem when none fits: add it to `problems` with a key (n1, n2…) and point the post at the key. Several posts in this batch can share one new problem.
- "" when the post raises no problem a product could ease: a one-off question about starting out or which tool to choose, a legal or tax question about one situation, a consumer's personal question, feedback on a store, venting about one customer, chatter, a job post for one-off build work, or a big platform's own trouble that only its maker can fix (its app crashing or losing data, logins, slow support, fees, held payouts, frozen accounts).

A question can still raise a problem: "how do you keep track of which tenant paid?" raises tracking rent payments. A job post paying someone to do a chore by hand every week (bookkeeping, data entry, reconciling, copying between systems) raises that chore as a problem.

A problem is specific enough that one product could solve it and general enough that different people's posts land on it. "Admin is a pain" is too broad; "Square doesn't export tips per employee in the format my payroll needs" is fine; one shop's one broken order is too narrow. Name it in the words of the people who have it, not as a product. Pick its category from the list in problems.md; anything that fits none goes under the last one.

For each post that raises a problem, also say what it tells about it: `recurring`, `cost`, `workaround` and a short `quote`, each only from what the post says. Never add facts the post doesn't have.

Every post of posts.md goes in `posts` exactly once, by its ref, including the ones that raise no problem.

Deliver the sort by calling the StructuredOutput tool with it as the arguments (`problems` and `posts` arrays, not strings). Don't write the sort or any JSON as text.
