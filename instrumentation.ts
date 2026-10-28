/**
 * Runs once when the server boots. Without Redis there is no separate worker,
 * so the web server itself fires scheduled workflows every 30 seconds.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (!process.env.REDIS_URL) {
      const { startInlineScheduler } = await import("./lib/engine/scheduler");
      startInlineScheduler();
    }
  }
}
