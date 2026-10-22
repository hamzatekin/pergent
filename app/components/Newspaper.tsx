import type { NewsBox, NewsPage, NewspaperView, NewsStory } from "../server/newspaper-view.ts";
import { SaveToNotes } from "./SaveToNotes.tsx";
import { StoryImage } from "./StoryImage.tsx";

type Labels = { contextLabel?: string; briefsLabel?: string };

// The words the page prints itself, in the paper's language: news is Turkish, tech English.
type Words = { issue: string; price: string; inside: string; page: string; briefs: string; ref: (page: number) => string };
const WORDS: Record<string, Words> = {
  tr: { issue: "Sayı", price: "Fiyatı", inside: "İç sayfalar", page: "sayfa", briefs: "Kısaca", ref: (page) => `» ${page}${suffix(page)}` },
  en: { issue: "No.", price: "Price", inside: "Inside", page: "page", briefs: "In brief", ref: (page) => `» Page ${page}` },
};
const wordsFor = (lang: string) => WORDS[lang.split("-")[0]] ?? WORDS.en;

// The paper as a printed Turkish daily, after Posta, Milliyet and Hürriyet: page one with the sürmanşet
// band above the red masthead, the manşet in a heavy condensed face under it, a section that is only a
// list (tech's TL;DR) in a box, a few stories in ruled columns and boxes at the foot pointing inside;
// then a page per section, each with its header strip, a lead, the stories in columns and the briefs in a box. The model chose the places, kickers, display
// headlines and spots (app/server/newspaper-view.ts). Bodies and asides are the model's markdown as
// HTML, set unsanitized like the cards view: the CSP is what keeps a script in it from running.
export function Newspaper({ paper, labels }: { paper: NewspaperView; labels: Labels }) {
  const words = wordsFor(paper.lang);
  return (
    <div className="np">
      <div className="np-sheet np-front">
        {paper.top.length > 0 && (
          <div className="np-top" data-count={paper.top.length}>
            {paper.top.map((story) => (
              <a key={story.id} className="np-top-item" href={`#${story.id}`}>
                {story.image && <StoryImage key={story.image} src={story.image} />}
                <span className="np-top-text">
                  {story.kicker && <span className="np-kicker">{story.kicker}</span>}
                  <span className="np-top-head">{story.headline}</span>
                  {story.spot && <span className="np-top-spot">{story.spot}</span>}
                  {story.page && <PageRef page={story.page} words={words} />}
                </span>
              </a>
            ))}
          </div>
        )}
        <header className="np-masthead">
          <p className="np-logo">{paper.name}</p>
          {paper.motto && <p className="np-motto">{paper.motto}</p>}
          <p className="np-dateline">
            <span>{paper.date}</span>
            <span>
              {words.issue} {paper.issue}
            </span>
            {paper.price && (
              <span>
                {words.price}: {paper.price}
              </span>
            )}
          </p>
        </header>
        {paper.lead && <Manset story={paper.lead} labels={labels} />}
        {paper.boxes.map((box) => (
          <Box key={box.heading} box={box} />
        ))}
        {paper.front.length > 0 && (
          <Columns stories={paper.front} labels={labels} wideFirst />
        )}
        {paper.teasers.length > 0 && (
          <nav className="np-teasers" aria-label={words.inside}>
            {paper.teasers.map((story) => (
              <a key={story.id} className="np-teaser" href={`#${story.id}`}>
                <span className="np-teaser-head">{story.headline}</span>
                {story.page && <PageRef page={story.page} words={words} />}
              </a>
            ))}
          </nav>
        )}
      </div>
      {paper.pages.map((page) => (
        <Page key={page.number} page={page} paper={paper} labels={labels} words={words} />
      ))}
    </div>
  );
}

function Manset({ story, labels }: { story: NewsStory; labels: Labels }) {
  return (
    <article className="np-manset" id={story.id}>
      {story.kicker && <p className="np-kicker np-kicker-bar">{story.kicker}</p>}
      {/* A paper from before display headlines has a sentence here, set smaller so it still fits the page. */}
      <h2 className="np-manset-head" data-long={story.headline.length > 40 || undefined}>
        {story.headline}
      </h2>
      {story.spot && <p className="np-manset-spot">{story.spot}</p>}
      <div className="np-main">
        {story.image && <StoryImage key={story.image} src={story.image} />}
        <div className="np-text">
          <Text story={story} labels={labels} />
        </div>
      </div>
    </article>
  );
}

// A section that is only a list, such as tech's TL;DR: its bullets in a ruled box under the manşet.
function Box({ box }: { box: NewsBox }) {
  return (
    <aside className="np-box">
      <h3 className="np-briefs-head">{box.heading}</h3>
      <div className="np-body" dangerouslySetInnerHTML={{ __html: box.html }} />
    </aside>
  );
}

function Page({ page, paper, labels, words }: { page: NewsPage; paper: NewspaperView; labels: Labels; words: Words }) {
  return (
    <section className="np-sheet np-page" id={`${words.page}-${page.number}`}>
      <header className="np-pagehead">
        <h2 className="np-pagehead-name">{page.heading}</h2>
        <span className="np-pagehead-meta">
          {paper.date} · {paper.name}
        </span>
        <span className="np-pagenum">{page.number}</span>
      </header>
      {page.intro && <div className="np-body np-intro" dangerouslySetInnerHTML={{ __html: page.intro }} />}
      {page.lead && <StoryBlock story={page.lead} labels={labels} size="lead" />}
      {page.stories.length > 0 && <Columns stories={page.stories} labels={labels} />}
      {page.briefs.length > 0 && (
        <aside className="np-briefs" data-count={Math.min(page.briefs.length, 3)}>
          <h3 className="np-briefs-head">{labels.briefsLabel ?? words.briefs}</h3>
          {page.briefs.map((story) => (
            <article key={story.id} id={story.id} className="np-brief">
              <h4>{story.headline}</h4>
              <div className="np-body" dangerouslySetInnerHTML={{ __html: story.body }} />
              <Foot story={story} />
            </article>
          ))}
        </aside>
      )}
    </section>
  );
}

// Stories in ruled columns, two on a tablet and three on a wide screen. The last story stretches over
// whatever its row leaves empty at each width, so the page has no hole, as a laid-out page would not.
// On page one the first story with a photo is two columns wide.
function Columns({ stories, labels, wideFirst = false }: { stories: NewsStory[]; labels: Labels; wideFirst?: boolean }) {
  const wide = wideFirst && !!stories[0]?.image;
  const units = stories.length + (wide ? 1 : 0);
  const fill = (cols: number) => (cols - (units % cols)) % cols;
  return (
    <div className="np-columns">
      {stories.map((story, i) => {
        const last = i === stories.length - 1;
        return (
          <StoryBlock
            key={story.id}
            story={story}
            labels={labels}
            size={wide && i === 0 ? "wide" : "normal"}
            fill={last ? { md: fill(2) + (wide && i === 0 ? 1 : 0), lg: fill(3) + (wide && i === 0 ? 1 : 0) } : undefined}
          />
        );
      })}
    </div>
  );
}

// A story in a ruled column: the kicker in red over the headline, the photo, the spot in bold, the
// text. "lead" is a page's opening story across the page, "wide" a front-page story two columns wide.
function StoryBlock({ story, labels, size, fill }: { story: NewsStory; labels: Labels; size: "lead" | "wide" | "normal"; fill?: { md: number; lg: number } }) {
  return (
    <article className="np-story" id={story.id} data-size={size} data-fill-md={fill?.md || undefined} data-fill-lg={fill?.lg || undefined}>
      {story.kicker && <p className={size === "lead" ? "np-kicker np-kicker-bar" : "np-kicker"}>{story.kicker}</p>}
      <h3 className="np-head">{story.headline}</h3>
      <div className="np-main">
        {story.image && <StoryImage key={story.image} src={story.image} />}
        <div className="np-text">
          {story.spot && <p className="np-spot">{story.spot}</p>}
          <Text story={story} labels={labels} />
        </div>
      </div>
    </article>
  );
}

function Text({ story, labels }: { story: NewsStory; labels: Labels }) {
  return (
    <>
      <div className="np-body" dangerouslySetInnerHTML={{ __html: story.body }} />
      {story.context && (
        <aside className="np-context">
          <h4>{labels.contextLabel ?? "Context"}</h4>
          <div dangerouslySetInnerHTML={{ __html: story.context }} />
        </aside>
      )}
      <Foot story={story} />
    </>
  );
}

function Foot({ story }: { story: NewsStory }) {
  if (!story.source && !story.mute && !story.save) return null;
  return (
    <div className="np-foot">
      {story.source && (
        <a className="np-source" href={story.source} target="_blank" rel="noopener">
          {story.sourceHost} ↗
        </a>
      )}
      {story.save && <SaveToNotes place={story.save} className="np-save" />}
      {story.mute && (
        <a className="np-mute" href={story.mute} rel="nofollow">
          Never show
        </a>
      )}
    </div>
  );
}

// The page a story continues on: "» Page 3" in English, "» 3'te" in Turkish.
function PageRef({ page, words }: { page: number; words: Words }) {
  return <span className="np-pageref">{words.ref(page)}</span>;
}

// The locative suffix a Turkish paper prints after a page number, which follows the last sound of the
// number as it is read (üç → 'te, altı → 'da).
const SUFFIX = ["'da", "'de", "'de", "'te", "'te", "'te", "'da", "'de", "'de", "'da"];
const TENS = ["", "'da", "'de", "'da", "'ta", "'de", "'ta", "'te", "'de", "'da"];
const suffix = (page: number) => (page % 10 ? SUFFIX[page % 10] : TENS[Math.floor(page / 10) % 10]);
