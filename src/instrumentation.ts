/**
 * Runs once when the server starts. The Node-only check lives in its own file
 * so the Edge build never sees `process.exit`.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./instrumentation-node");
}
