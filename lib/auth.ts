import { createHmac, timingSafeEqual } from "node:crypto";

const SESSION_SECRET =
  process.env.AUTH_SESSION_SECRET || "dev-session-secret-change-me";
const AUTH_USER = process.env.AUTH_USERNAME || "clinician";
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || "flo2-demo";

export const SESSION_COOKIE_NAME = "flo2_session";

type SessionPayload = {
  username: string;
  expiresAt: number;
};

function sign(value: string) {
  return createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
}

function toBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

export function validateCredentials(username: string, password: string) {
  return username === AUTH_USER && password === AUTH_PASSWORD;
}

export function createSessionToken(username: string) {
  const payload: SessionPayload = {
    username,
    expiresAt: Date.now() + 1000 * 60 * 60 * 12,
  };

  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = sign(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export function readSessionToken(token?: string | null) {
  if (!token) return null;

  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return null;

  const expectedSignature = sign(encodedPayload);
  const provided = Buffer.from(signature, "hex");
  const expected = Buffer.from(expectedSignature, "hex");

  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  try {
    const payload = JSON.parse(fromBase64Url(encodedPayload)) as SessionPayload;
    if (payload.expiresAt <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
