adverts.md above holds software developer job adverts in the UK or remote from it, grouped by company. Each advert has a ref (a1, a2…), its title and location, then its text. When a company has several adverts, what all of them say (about the company, often its tech stack) is shown once under the company's name as "What every … advert says", and each advert below it has only its own text.

The reader is a software developer, frontend first and open to full stack and backend roles, who needs visa sponsorship. The page built from your reading counts which roles are hiring, which technologies they ask for and how that changes from week to week, so read each advert on its own and only from what it says. Never add a fact the advert doesn't have.

For every advert:
- `family`: what the role mostly works on, from its duties and requirements, not only its title. Most titles are just "Software Engineer", which is why you read the text. A role that works on both the web UI and the server is fullstack; one whose duties are the UI is frontend even when it mentions an API. A job that is not writing software (a manager, a sales or solutions engineer, support, an analyst) is "not a developer".
- `skills`: the technologies this role works with. Take them from the advert's own text first. A company's shared stack counts for the role only for the part the role works on: a frontend role gets the company's web stack, not its data tools.
- `niceToHave`, `minYears`, `sponsorship` and `aiTools` as their descriptions say. `sponsorship` is only what the advert's words say; "not said" when they say nothing about visas or the right to work.

Every advert of adverts.md goes in `adverts` exactly once, by its ref.

Deliver the reading by calling the StructuredOutput tool with it as the arguments (an `adverts` array, not a string). Don't write it or any JSON as text.
