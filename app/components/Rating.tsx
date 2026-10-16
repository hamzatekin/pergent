import type { Rating as RatingData } from "#src/paper.ts";

// Jev's rating (src/rate.ts): the overall number large, then each part on its own line as a name, a
// ten-cell bar and its number, with what it measures in the tooltip. Cells and colour are classes,
// since the CSP allows no inline style.
const PARTS: [key: string, name: string, meaning: string][] = [
  ["sourcing", "Sourcing", "How well the claim is backed: a rumour, one account, a named outlet, or a primary source"],
  ["neutrality", "Neutral tone", "How plain the original is: hype or propaganda, spun, mostly factual, or plain"],
  ["substance", "Substance", "How much the story gives you: nothing concrete, one fact, some detail, or specifics and why it matters"],
];

const level = (score: number) => (score >= 7 ? "high" : score >= 4.5 ? "mid" : "low");

export function Rating({ rating }: { rating: RatingData }) {
  return (
    <div className="rating" data-level={level(rating.score)}>
      <span className="overall" title="Rated by Jev, 0-10">
        <span className="score">{rating.score.toFixed(1)}</span>
        <span className="of">/10</span>
      </span>
      <span className="parts">
        {PARTS.filter(([key]) => typeof rating.parts[key] === "number").map(([key, name, meaning]) => {
          const v = rating.parts[key];
          return (
            <span key={key} className="part" data-level={level(v)} title={meaning}>
              <span className="name">{name}</span>
              <span className="cells">
                {Array.from({ length: 10 }, (_, i) => (
                  <i key={i} className={i < Math.round(v) ? "on" : undefined} />
                ))}
              </span>
              <span className="num">{v.toFixed(1)}</span>
            </span>
          );
        })}
      </span>
    </div>
  );
}
