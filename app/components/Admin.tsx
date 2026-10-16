import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

// While a run is going the page reloads its data every 10s, so the status, time and cost keep up.
export function useRefreshWhile(live: boolean) {
  const router = useRouter();
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => router.invalidate(), 10_000);
    return () => clearInterval(timer);
  }, [live, router]);
}

export function Badge({ status }: { status: string }) {
  return (
    <span className="badge" data-status={status}>
      {status}
    </span>
  );
}
