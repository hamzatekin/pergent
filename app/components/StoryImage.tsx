import { useEffect, useRef, useState } from "react";

// A story's lead image. A feed thumbnail too small for the card looks worse than no image, and a broken
// one worse still, so both are dropped. A portrait or square image (a vertical video's thumbnail) is
// marked tall, and styles.css shows it whole instead of cutting its middle out to fill the wide frame.
// An image still loading is hidden (data-loading) and fades in once checked, so it never shows cropped
// or half drawn; one that loaded before the page hydrated is checked at once. Without the script the
// image just shows.
export function StoryImage({ src }: { src: string }) {
  const ref = useRef<HTMLImageElement>(null);
  const [state, setState] = useState<"unknown" | "loading" | "shown" | "tall" | "gone">("unknown");
  useEffect(() => {
    const img = ref.current;
    if (!img) return;
    const check = () => {
      const w = img.naturalWidth;
      setState(w === 0 ? "gone" : w < 300 ? "gone" : img.naturalHeight > w * 0.9 ? "tall" : "shown");
    };
    const fail = () => setState("gone");
    img.addEventListener("load", check);
    img.addEventListener("error", fail);
    if (img.complete) check();
    else setState("loading");
    return () => {
      img.removeEventListener("load", check);
      img.removeEventListener("error", fail);
    };
  }, []);
  if (state === "gone") return null;
  return <img ref={ref} className={state === "tall" ? "story-image tall" : "story-image"} src={src} alt="" loading="lazy" data-loading={state === "loading" ? "" : undefined} />;
}
