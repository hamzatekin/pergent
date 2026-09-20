// The page is rendered by the server; this is the little that needs a browser.
(() => {
  // ← and → step between runs; the links carry the key they answer to.
  addEventListener("keydown", (e) => {
    const link = document.querySelector(`a.arrow[data-key="${e.key}"]`);
    if (link && link.getAttribute("aria-disabled") !== "true" && !e.metaKey && !e.ctrlKey && !e.altKey) location.href = link.href;
  });

  // A feed thumbnail too small for the card looks worse than no image, and a broken one worse still.
  for (const img of document.querySelectorAll("img.story-image")) {
    const check = () => {
      if (img.naturalWidth > 0 && img.naturalWidth < 300) img.remove();
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
