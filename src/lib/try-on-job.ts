import { createHmac, timingSafeEqual } from "node:crypto";

type TryOnJobToken = {
  runId: string;
  userId: string;
  issuedAt: number;
};

const MAX_JOB_AGE_MS = 2 * 60 * 60 * 1000;

function signingSecret() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("Try-on job signing is not configured.");
  return secret;
}

function signature(payload: string) {
  return createHmac("sha256", signingSecret()).update(payload).digest("base64url");
}

export function signTryOnJob(runId: string, userId: string) {
  const payload = Buffer.from(JSON.stringify({ runId, userId, issuedAt: Date.now() } satisfies TryOnJobToken)).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function verifyTryOnJob(token: string, expectedUserId: string): TryOnJobToken | null {
  const [payload, suppliedSignature] = token.split(".");
  if (!payload || !suppliedSignature) return null;
  const expectedSignature = signature(payload);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as TryOnJobToken;
    if (!parsed.runId || parsed.userId !== expectedUserId || !Number.isFinite(parsed.issuedAt)) return null;
    if (Date.now() - parsed.issuedAt > MAX_JOB_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}
