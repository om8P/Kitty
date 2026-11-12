/**
 * S07 spike: a tiny local receiver for PayPal sandbox webhooks. Point a free
 * tunnel at it (for example `ngrok http 8787`) and register
 * `<tunnel URL>/webhook` in the PayPal developer dashboard.
 *
 *   npx tsx scripts/spike/webhook-receiver.ts [--port 8787]
 *
 * Every POST is saved, with only PayPal's headers and the raw body, to the
 * gitignored .spike-logs/S07/deliveries/ folder and answered with 200. It
 * reads no credentials and verifies nothing: scripts/spike/07-webhooks.ts
 * checks signatures afterwards. Sandbox only.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { deliveryFileName, pickPayPalHeaders, summarizeEvent, type Delivery } from "./s07-helpers";

const DIR = join(".spike-logs", "S07", "deliveries");
const MAX_BODY_BYTES = 1_000_000;

function portFromArgs(args: string[]): number {
  const i = args.indexOf("--port");
  const port = i >= 0 ? Number(args[i + 1]) : 8787;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("--port must be a port number");
  return port;
}

mkdirSync(DIR, { recursive: true });
const port = portFromArgs(process.argv.slice(2));
let seq = 0;

const server = createServer((req, res) => {
  if (req.method !== "POST") {
    res.writeHead(200, { "content-type": "text/plain" }).end("Kitty S07 webhook receiver is running.\n");
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  req.on("data", (chunk: Buffer) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      res.writeHead(413).end();
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => {
    if (res.writableEnded) return;
    const receivedAt = new Date();
    const delivery: Delivery = {
      receivedAt: receivedAt.toISOString(),
      method: req.method ?? "POST",
      path: req.url ?? "/",
      headers: pickPayPalHeaders(req.headers),
      rawBody: Buffer.concat(chunks).toString("utf8"),
    };
    seq += 1;
    const file = deliveryFileName(receivedAt, delivery.headers["paypal-transmission-id"], seq);
    writeFileSync(join(DIR, file), `${JSON.stringify(delivery, null, 2)}\n`);
    const event = summarizeEvent(delivery.rawBody);
    console.log(
      `${delivery.receivedAt} ${event?.eventType ?? "(not an event)"} ${event?.resourceId ?? ""} ` +
        `${event?.status ?? ""} ${event?.amount ? `$${event.amount}` : ""} -> ${file}`,
    );
    res.writeHead(200, { "content-type": "text/plain" }).end("ok\n");
  });
});

server.listen(port, () => console.log(`S07 receiver listening on http://localhost:${port}, saving to ${DIR}`));
