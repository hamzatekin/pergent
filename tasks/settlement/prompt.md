The file settlement.md above holds what the official sources and the news said in the last few days about the UK's "earned settlement" reform of indefinite leave to remain (ILR), only what earlier papers have not reported:
- Watched GOV.UK pages: the earned settlement consultation, the statements of changes to the Immigration Rules, the ILR guide for Skilled Workers, the Skilled Worker, Skilled Occupations and Long Residence appendices, and the 2025 immigration white paper. Every page is listed with when it last changed; one marked **CHANGED** changed since the last paper, with its change notes and any new documents.
- New Home Office, UKVI and Migration Advisory Committee publications on GOV.UK that mention settlement, ILR, the Immigration Rules or Skilled Workers.
- Parliament: Home Office written statements (a statement of changes to the Immigration Rules is announced in one), written questions the Home Office answered, and what was said in debates (Hansard).
- News headlines (Google News: headline, outlet, date; no article text) and posts from Free Movement, the Electronic Immigration Network and the House of Commons Library, with their text.

last.md is the previous paper of this task in full. Its "Where things stand" section is what the reader was told last; carry it forward and change only what today's sources change.

The reader lives in the UK on a Skilled Worker visa, sponsored in SOC code 3131 (IT operations technicians), a job at RQF level 3, so "medium skilled", below degree level (RQF 6). Under today's rules they qualify for ILR after 5 years. They want to know, every morning, whether anything changed on:
1. the qualifying period: the proposed 10-year baseline, and 15 years for Skilled Workers in jobs below RQF 6, like theirs;
2. salary and other conditions by RQF level: the earnings that would shorten the wait, the minimum earnings, English at B2, and anything that treats RQF 3 to 5 jobs differently;
3. whether it applies retrospectively to people already in the UK on a 5-year route;
4. the transitional rules and the timing: who is protected, the cut-off dates, when a statement of changes is laid and when it takes effect;
and, since they need to stay on the route to get there at all, anything about extending a Skilled Worker visa in an RQF 3 to 5 job (the Temporary Shortage List, the Immigration Salary List, salary thresholds for their occupation code).

What was known on 16 October 2026, when this task started (use it only when last.md has no paper; a newer source always wins):
- The government published "A Fairer Pathway to Settlement" and its consultation on 20 November 2025; it closed on 12 February 2026 with well over 100,000 responses. It proposed a 10-year baseline for ILR, 15 years for Skilled Workers in jobs below RQF 6 and for care workers, shorter waits for contribution (earnings over £50,270 for three years: 5 years off; over £125,140: settlement after 3 years; some public service jobs at RQF 6 and above: 5 years off; volunteering), a minimum of £12,570 a year in earnings, English at B2 (C1 takes a year off), and longer waits for claiming benefits or overstaying.
- It said the framework would apply to everyone, including people already on a route, and consulted on whether to have transitional arrangements. Backbench MPs opposed applying it retrospectively in a Westminster Hall debate on 2 February 2026.
- No government response and no statement of changes bringing the 10 or 15-year periods in had been published. In July 2026 the Home Secretary told the Commons that ILR and the transitional arrangements would be "settled policy later this year"; on 15 September she told the Home Affairs Committee the revised policy would be set out before the end of 2026. Around Labour's conference in late September she signalled the plans would be softened, after criticism within Labour of moving the goalposts for people already here.
- Since 22 July 2025 new Skilled Worker visas need a job at RQF 6 or above; people already sponsored below that can extend in the same job under transitional protection, and jobs at RQF 3 to 5 for new applicants need to be on the Temporary Shortage List.

You hand it over as structured output, a paper: a `title`, then `sections`, each with a `heading`, an optional `lead` and its `stories`.

Sections, in this order:
1. "🔔 What changed" — `lead`: one or two sentences that answer the reader's question for today, plainly: either "Nothing has changed for you since yesterday's paper: …" with the single most relevant thing the sources said, or what changed and what it means for an RQF 3 Skilled Worker on a 5-year route. Its `stories`: one per real change or official signal in settlement.md (a published response, a statement of changes, a changed GOV.UK page, a written statement, a minister's answer or words in Parliament that add something, a Migration Advisory Committee report). None when nothing changed; the lead says so.
2. "📌 Where things stand" — always exactly four stories, one per question above, in that order, each importance 2: `headline` the current position in one line ("Qualifying period: 15 years proposed for RQF 3-5 jobs, not decided"); `body` the position, whether it is proposed, decided, laid before Parliament or in force, with the date and who said it; `context` what it means for the reader; `source` the most authoritative URL behind it (GOV.UK or Parliament before news), taken from settlement.md or last.md. When today's sources move a position, start the body with "Updated:" and say what moved.
3. "📰 Also in the sources" — briefs (importance 1, body one sentence): news, blog posts, debates and answers that are about settlement or Skilled Workers but change nothing, so the reader sees what was said. Leave out anything about the EU Settlement Scheme, asylum, refugees' resettlement or other routes that does not touch Skilled Workers. Leave the section out when there is nothing.

For each story in "What changed":
- `headline`: what changed, in one plain line.
- `body`: what the source says, in two to four sentences, with dates, numbers and the RQF levels it names; quote the official wording when it decides something. When the source publishes final rules or a firm implementation date, list what changed on each of the four questions and the dates: when the statement of changes was laid, when it takes effect, and any cut-off or transition date for people already on a route; say plainly when the source gives no date. Never add facts the sources do not have, and say "proposed", "expected" or "decided" as the source does. A news headline alone is a claim by that outlet; say so ("The Guardian reports …").
- `context`: what it means for the reader, an RQF 3 Skilled Worker on a 5-year route; one or two sentences.
- `source`: its URL exactly as in settlement.md.
- `importance`: 3 for a decision (a published response, a statement of changes, rules in force or a firm date); 2 for an official signal or a change to a watched page; 1 for anything weaker.

`title`: "Settlement watch, <date>", the date written out like "October 16, 2026".

Deliver the paper by calling the StructuredOutput tool with it as the arguments (`sections` an array, not a string). Don't write the paper or any JSON as text.
