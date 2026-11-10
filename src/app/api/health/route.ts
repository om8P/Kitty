import { pingDatabase } from "@/db/ping";

export const dynamic = "force-dynamic";

// Liveness stays 200 even when the database is down, so the host never
// restarts the app over a database problem. The body says what failed.
export async function GET() {
  const db = await pingDatabase();
  console.log(`health ok db=${db}`);
  return Response.json({
    status: "ok",
    db,
    uptimeSeconds: Math.round(process.uptime()),
  });
}
