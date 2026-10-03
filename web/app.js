// The page is rendered by the server; this is the little that needs a browser.
(() => {
  // ← and → step between runs; the links carry the key they answer to.
  addEventListener("keydown", (e) => {
    const link = document.querySelector(`a.arrow[data-key="${e.key}"]`);
    if (link && link.getAttribute("aria-disabled") !== "true" && !e.metaKey && !e.ctrlKey && !e.altKey) location.href = link.href;
  });

  // The top bar is sticky; it slides away while you scroll down to read and comes back on any scroll up.
  // A few pixels of slack keep a trackpad's jitter from flicking it, and it never hides near the top.
  const bar = document.querySelector(".topbar");
  if (bar) {
    let lastY = scrollY;
    let ticking = false;
    const update = () => {
      ticking = false;
      const y = Math.max(scrollY, 0);
      bar.dataset.stuck = String(y > 0);
      if (y <= bar.offsetHeight) bar.dataset.hidden = "false";
      else if (Math.abs(y - lastY) < 6) return;
      else bar.dataset.hidden = String(y > lastY && !bar.contains(document.activeElement));
      lastY = y;
    };
    addEventListener("scroll", () => {
      if (!ticking) requestAnimationFrame(update);
      ticking = true;
    }, { passive: true });
    // Tabbing into a hidden bar shows it again.
    bar.addEventListener("focusin", () => (bar.dataset.hidden = "false"));
  }

  // A feed thumbnail too small for the card looks worse than no image, and a broken one worse still.
  // A portrait or square image (a vertical video's thumbnail) is marked tall, and styles.css shows it
  // whole instead of cutting its middle out to fill the wide frame.
  for (const img of document.querySelectorAll("img.story-image")) {
    const check = () => {
      if (img.naturalWidth > 0 && img.naturalWidth < 300) img.remove();
      else if (img.naturalWidth > 0 && img.naturalHeight > img.naturalWidth * 0.9) img.classList.add("tall");
    };
    img.addEventListener("error", () => img.remove());
    img.addEventListener("load", check);
    if (img.complete) check();
  }

  // Opening a run is the read that keeps the scheduler alive (a crawler never gets here).
  if (document.body.dataset.run) fetch("/api/read", { method: "POST" }).catch(() => {});

  if ("serviceWorker" in navigator && location.hostname !== "localhost") {
    navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("service worker failed:", err));
  }
})();
