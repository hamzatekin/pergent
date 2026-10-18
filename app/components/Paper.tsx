import type { PaperView, StoryView } from "../server/paper-view.ts";
import { SaveToNotes } from "./SaveToNotes.tsx";
import { StoryImage } from "./StoryImage.tsx";

type Labels = { contextLabel?: string; briefsLabel?: string };

// The paper. Headlines and headings are text; bodies, leads and asides are the model's markdown,
// rendered on the server (app/server/paper-view.ts) and set as HTML, unsanitized: the CSP (start.ts)
// is what keeps a script in it from running.
export function Paper({ paper, labels }: { paper: PaperView; labels: Labels }) {
  return (
    <div className="paper">
      {paper.title && <h1 className="masthead">{paper.title}</h1>}
      {paper.sections.map((section, i) => (
        <section key={i} className="section">
          {section.heading && (
            <h2 className="section-head">
              {section.heading}
              {section.cards.length + section.briefs.length > 0 && <span className="count">{section.cards.length + section.briefs.length}</span>}
            </h2>
          )}
          {section.lead && <div className="prose lead" dangerouslySetInnerHTML={{ __html: section.lead }} />}
          {/* Cards sit in a grid on a wide screen, a lead story two columns wide; one column on a phone.
              The section's briefs follow the grid as one band of short lines, in the order written. */}
          {section.cards.length > 0 && (
            <div className="stories">
              {section.cards.map((story, j) => (
                <article key={j} className="story" data-importance={story.importance}>
                  {story.image && <StoryImage key={story.image} src={story.image} />}
                  <div className="prose">
                    <StoryText story={story} labels={labels} />
                  </div>
                </article>
              ))}
            </div>
          )}
          {section.briefs.length > 0 && (
            <div className="briefs">
              <h4 className="briefs-head">{labels.briefsLabel ?? "In brief"}</h4>
              {section.briefs.map((story, j) => (
                <article key={j} className="brief prose">
                  <StoryText story={story} labels={labels} />
                </article>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

function StoryText({ story, labels }: { story: StoryView; labels: Labels }) {
  return (
    <>
      <div className="story-text" dangerouslySetInnerHTML={{ __html: story.html }} />
      {story.context && (
        <details className="aside">
          <summary>{labels.contextLabel ?? "Context"}</summary>
          <div dangerouslySetInnerHTML={{ __html: story.context }} />
        </details>
      )}
      {/* A div, not a p: the save button is a form, and a form cannot sit inside a paragraph. */}
      {(story.source || story.mute || story.save) && (
        <div className="foot">
          {story.source && (
            <a className="src" href={story.source} target="_blank" rel="noopener">
              {story.sourceHost} ↗
            </a>
          )}
          {story.save && <SaveToNotes place={story.save} className="save" />}
          {story.mute && (
            <a className="mute" href={story.mute} rel="nofollow">
              Never show
            </a>
          )}
        </div>
      )}
    </>
  );
}
