/**
 * Demo sessions. There are no passwords: starting the demo creates a fresh
 * household and sets a signed cookie naming the household and the current
 * persona. The server checks every action against it, so switching persona to
 * the teen really does lose the owner's powers.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { Database } from "@/domain/ports";
import { DomainError, type UserRow } from "@/domain/types";

const COOKIE_NAME = "kitty_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 14;

const store = globalThis as typeof globalThis & { __kittySecret?: string };

function secret(): string {
  const configured = process.env.SESSION_SECRET?.trim();
  if (configured) return configured;
  // No secret set: use one that lasts until the process restarts.
  store.__kittySecret ??= randomBytes(32).toString("hex");
  return store.__kittySecret;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function encodeSession(session: { householdId: string; userId: string }): string {
  const payload = Buffer.from(JSON.stringify({ h: session.householdId, u: session.userId })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function decodeSession(value: string | undefined): { householdId: string; userId: string } | null {
  if (!value) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { h?: unknown; u?: unknown };
    if (typeof data.h !== "string" || typeof data.u !== "string") return null;
    return { householdId: data.h, userId: data.u };
  } catch {
    return null;
  }
}

export async function setSessionCookie(session: { householdId: string; userId: string }): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE_NAME, encodeSession(session), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

export type Session = { householdId: string; user: UserRow; users: UserRow[] };

/** The current session, or null. The user is re-read from the database on every call. */
export async function getSession(db: Database): Promise<Session | null> {
  const jar = await cookies();
  const decoded = decodeSession(jar.get(COOKIE_NAME)?.value);
  if (!decoded) return null;
  const users = await db.query<UserRow>("SELECT * FROM users WHERE household_id = $1 ORDER BY role DESC, name", [
    decoded.householdId,
  ]);
  const user = users.find((candidate) => candidate.id === decoded.userId);
  if (!user) return null;
  return { householdId: decoded.householdId, user, users };
}

export async function requireSession(db: Database): Promise<Session> {
  const session = await getSession(db);
  if (!session) throw new DomainError("forbidden", "Start the demo to continue.");
  return session;
}

/** True when the given code matches DEMO_ACCESS_CODE, or when no code is required. */
export function accessCodeMatches(given: string | undefined): boolean {
  const required = process.env.DEMO_ACCESS_CODE?.trim();
  if (!required) return true;
  const a = Buffer.from(required);
  const b = Buffer.from((given ?? "").trim());
  return a.length === b.length && timingSafeEqual(a, b);
}

export function accessCodeRequired(): boolean {
  return Boolean(process.env.DEMO_ACCESS_CODE?.trim());
}
