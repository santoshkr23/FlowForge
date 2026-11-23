/**
 * Runs once when the server boots. Without Redis there is no separate worker,
 * so the web server itself fires scheduled workflows every 30 seconds.
 */
export async function register() {
  // don't start timers inside `next build`
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // API keys saved in /admin → keep them in memory, refreshed every 30 s
    const { loadConfig } = await import("./lib/config");
    await loadConfig(true);
    setInterval(() => loadConfig(true).catch(() => {}), 30_000).unref?.();
    if (!process.env.REDIS_URL) {
      const { startInlineScheduler } = await import("./lib/engine/scheduler");
      startInlineScheduler();
    }
  }
}
