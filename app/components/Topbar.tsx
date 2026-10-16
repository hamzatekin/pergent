import { useEffect, useRef, type ReactNode } from "react";

// The bar stays at the top of the screen. It slides away while you scroll down to read and comes back
// on any scroll up; data-stuck draws its edge once the page is under it. A few pixels of slack keep a
// trackpad's jitter from flicking it, and it never hides near the top. Attributes, not state, so a
// scroll never re-renders the page.
export function Topbar({ children, hides = false }: { children: ReactNode; hides?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const bar = ref.current;
    if (!bar || !hides) return;
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
    const onScroll = () => {
      if (!ticking) requestAnimationFrame(update);
      ticking = true;
    };
    // Tabbing into a hidden bar shows it again.
    const onFocus = () => (bar.dataset.hidden = "false");
    addEventListener("scroll", onScroll, { passive: true });
    bar.addEventListener("focusin", onFocus);
    return () => {
      removeEventListener("scroll", onScroll);
      bar.removeEventListener("focusin", onFocus);
    };
  }, [hides]);
  return (
    <header ref={ref} className="topbar">
      {children}
    </header>
  );
}
