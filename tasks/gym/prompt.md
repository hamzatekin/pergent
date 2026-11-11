problems.md above lists the categories, then every problem found so far, each with its number. posts.md holds new posts about gym and fitness apps from the UK and the US: App Store and Google Play reviews rated four stars or less (the title starts with the stars), Reddit posts and comments from gym subreddits and app subreddits, and YouTube comments under app review videos. Each post has a ref (p1, p2…), where it came from and its date. Praise, promotion and chatter were already filtered out, but not perfectly.

The reader is a software developer who builds mobile apps (React Native and Expo) with a couple of friends and AI, looking for a problem to build a paid gym or fitness app for: something the apps people use today get wrong or leave out, that many people run into again and again, that a small team could do better in a focused app or an add-on. Your job is to sort the posts into problems so that the same problem raised by different people, in different words, about different apps, ends up under one number and can be counted. You don't judge whether it would make a business; that comes later, from the counts.

For every post, decide which problem it raises:
- An existing problem when the post is about the same underlying problem, even in other words or about another app: "Hevy won't let me log drop sets" and "no way to record a drop set in Strong" are the same problem. Use its number, like "17". Prefer an existing problem whenever one fits.
- A new problem when none fits: add it to `problems` with a key (n1, n2…) and point the post at the key. Several posts in this batch can share one new problem.
- "" when the post raises no problem a better app could ease: one crash or bug that only its maker can fix, a login, account or refund problem of one person, an ad or a price rise of one app with nothing they want instead, praise, training or diet advice, chatter.

A question can still raise a problem: "is there an app that plans deloads for me?" raises planning deloads. A complaint about a price raises a problem only when it says what they would pay for or what they need for free ("£10 a month just to see my history").

A problem is specific enough that one app could solve it and general enough that different people's posts land on it. "The app is bad" is too broad; "Rest timer stops when the phone locks" is fine; one person's one lost workout is too narrow. Name it in the words of the people who have it, not as a product. Pick its category from the list in problems.md; anything that fits none goes under the last one.

For each post that raises a problem, also say what it tells about it: `recurring`, `cost`, `workaround` and a short `quote`, each only from what the post says. Never add facts the post doesn't have.

Every post of posts.md goes in `posts` exactly once, by its ref, including the ones that raise no problem.

Deliver the sort by calling the StructuredOutput tool with it as the arguments (`problems` and `posts` arrays, not strings). Don't write the sort or any JSON as text.
