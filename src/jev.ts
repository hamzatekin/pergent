// One Jev Choice question per text (TypeSafe's System One model, https://docs.typesafe.ai): which of
// `kinds` the text is, with a probability for each. 20 texts to a request, 6 requests at a time, each
// retried twice on 429/529. A request that fails leaves its texts unanswered and is listed in
// `failures`, so the caller decides what an unanswered text means (the filters keep it).
// Imported by the before scripts, so it imports nothing from the runner or the database.

export type ChoiceAnswer = { type: "choice"; choice: string; probabilities: Record<string, number> };

const BATCH = 20;
const CONCURRENCY = 6;

async function ask(texts: string[], kinds: Record<string, string>, about: string, apiKey: string): Promise<(ChoiceAnswer | undefined)[]> {
  const questions = Object.fromEntries(
    texts.map((_, i) => [
      `p${i}`,
      { type: "choice", instructions: `What kind of ${about} is \`posts[${i}]\`? Judge the post's own text.`, criteria: kinds },
    ]),
  );
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "jev-latest", state: { posts: texts }, questions }),
      signal: AbortSignal.timeout(60_000),
    });
    if ((res.status === 429 || res.status === 529) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { answers: Record<string, ChoiceAnswer> };
    return texts.map((_, i) => body.answers[`p${i}`]);
  }
}

export async function classify(
  texts: string[],
  kinds: Record<string, string>,
  about: string,
  apiKey: string,
): Promise<{ answers: (ChoiceAnswer | undefined)[]; requests: number; failures: string[] }> {
  const answers: (ChoiceAnswer | undefined)[] = new Array(texts.length);
  const starts: number[] = [];
  for (let i = 0; i < texts.length; i += BATCH) starts.push(i);
  const failures: string[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < starts.length) {
        const start = starts[next++];
        try {
          (await ask(texts.slice(start, start + BATCH), kinds, about, apiKey)).forEach((a, i) => (answers[start + i] = a));
        } catch (err) {
          failures.push(err instanceof Error ? err.message : String(err));
        }
      }
    }),
  );
  return { answers, requests: starts.length, failures };
}
