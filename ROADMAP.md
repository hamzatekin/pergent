# Roadmap

Ordered. One item per step, each verified with a real run before the next.

1. **Scheduler.** A minute tick in the server matches each task's cron string (`schedule` in task.json) against the current time and calls the same run function the API uses, skipping a task that is already running. No dependency. Until this exists nothing runs on the server by itself.

2. **Cluster headlines across feeds.** The RSS fetcher drops roughly half of the day's headlines by age to fit the read limit, so an early run mostly sees late-night items. Group near-identical titles across outlets into one line with the outlet count and names. Smaller input, and the count is the strongest importance signal there is. Google News and Bundle popular stay as extra signals.

3. **Yesterday's digest as input.** Pass the previous run's `output.md` to the model so stories continue instead of restarting, repeats are skipped, and a background block already given yesterday stays short.

Done: read-only site (editor and `PUT` route removed, `POST .../run` kept for curl until the scheduler exists); newspaper reading view (paper palette, story cards with lead images from `images.json`, phone first).

Later, not scheduled: fixed numbers box for Ekonomi from a data source instead of headlines; weekly recap task from the week's own outputs; notification on run finish or failure; Gmail route for newsletters without feeds; thumbs on stories feeding an interest profile back into the prompts.
