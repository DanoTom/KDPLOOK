import type { Env } from "./env";

const COOKIE_NAME = "kdplook_session";
const SESSION_DAYS = 30;

function secretFor(env: Env): string | null {
  const secret = env.AUTH_SECRET || env.AUTH_PASSWORD;
  return secret ? secret : null;
}

export function authEnabled(env: Env): boolean {
  return Boolean(env.AUTH_PASSWORD && env.AUTH_PASSWORD.length > 0);
}

async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64url(new Uint8Array(mac));
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Length-independent comparison, so a wrong token leaks no timing signal. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSessionCookie(env: Env): Promise<string> {
  const secret = secretFor(env);
  if (!secret) throw new Error("No auth secret configured");
  const expires = Date.now() + SESSION_DAYS * 86_400_000;
  const payload = String(expires);
  const signature = await sign(payload, secret);
  const token = `${payload}.${signature}`;
  const maxAge = SESSION_DAYS * 86_400;
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

export async function isAuthenticated(request: Request, env: Env): Promise<boolean> {
  if (!authEnabled(env)) return true;
  const secret = secretFor(env);
  if (!secret) return true;

  const token = readCookie(request, COOKIE_NAME);
  if (!token) return false;

  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;

  const expires = Number(payload);
  if (!Number.isFinite(expires) || expires < Date.now()) return false;

  const expected = await sign(payload, secret);
  return timingSafeEqual(signature, expected);
}

export async function checkPassword(env: Env, candidate: string): Promise<boolean> {
  const expected = env.AUTH_PASSWORD;
  if (!expected) return true;
  // Hash both sides first so the comparison is fixed-length.
  const [a, b] = await Promise.all([digest(candidate), digest(expected)]);
  return timingSafeEqual(a, b);
}

async function digest(value: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64url(new Uint8Array(hash));
}
