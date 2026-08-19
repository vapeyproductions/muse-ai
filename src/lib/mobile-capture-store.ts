import { createHash, randomBytes } from "node:crypto";
import { databasePool } from "@/lib/auth";
import { selfieForUser, type StoredSelfie } from "@/lib/selfie-store";

type MobileCaptureStatus = "pending" | "capturing" | "complete";

type MobileCaptureRow = {
  id: string;
  user_id: string;
  token_hash: string;
  status: MobileCaptureStatus;
  face_selfie_id: string | null;
  hair_left_selfie_id: string | null;
  hair_right_selfie_id: string | null;
  created_at: Date;
  expires_at: Date;
  completed_at: Date | null;
};

export type MobileCapturePhotos = {
  face: StoredSelfie;
};

const CAPTURE_WINDOW_MS = 20 * 60 * 1000;

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function publicStatus(row: MobileCaptureRow) {
  return row.expires_at.getTime() <= Date.now() && row.status !== "complete" ? "expired" : row.status;
}

export async function createMobileCaptureSession(userId: string, origin: string) {
  const id = crypto.randomUUID();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + CAPTURE_WINDOW_MS);
  await databasePool.query(
    `INSERT INTO public.mobile_capture_session
      (id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [id, userId, tokenHash(token), expiresAt],
  );
  return {
    id,
    status: "pending" as const,
    expiresAt: expiresAt.toISOString(),
    captureUrl: `${origin}/capture#${token}`,
  };
}

export async function mobileCaptureForUser(id: string, userId: string) {
  const result = await databasePool.query<MobileCaptureRow>(
    `SELECT * FROM public.mobile_capture_session
     WHERE id = $1 AND user_id = $2
     LIMIT 1`,
    [id, userId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const status = publicStatus(row);
  let photos: MobileCapturePhotos | null = null;
  if (status === "complete" && row.face_selfie_id) {
    const face = await selfieForUser(row.face_selfie_id, userId);
    if (face) photos = { face };
  }
  return {
    id: row.id,
    status,
    expiresAt: row.expires_at.toISOString(),
    photos,
  };
}

export async function mobileCaptureForToken(token: string) {
  const result = await databasePool.query<MobileCaptureRow>(
    `SELECT * FROM public.mobile_capture_session
     WHERE token_hash = $1
     LIMIT 1`,
    [tokenHash(token)],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    status: publicStatus(row),
    expiresAt: row.expires_at.toISOString(),
  };
}

export async function claimMobileCapture(token: string) {
  const result = await databasePool.query<MobileCaptureRow>(
    `UPDATE public.mobile_capture_session
     SET status = 'capturing'
     WHERE token_hash = $1
       AND status = 'pending'
       AND expires_at > now()
     RETURNING *`,
    [tokenHash(token)],
  );
  return result.rows[0] ?? null;
}

export async function releaseMobileCapture(id: string, userId: string) {
  await databasePool.query(
    `UPDATE public.mobile_capture_session
     SET status = 'pending'
     WHERE id = $1 AND user_id = $2 AND status = 'capturing' AND expires_at > now()`,
    [id, userId],
  );
}

export async function completeMobileCapture({
  id,
  userId,
  faceSelfieId,
}: {
  id: string;
  userId: string;
  faceSelfieId: string;
}) {
  const result = await databasePool.query(
    `UPDATE public.mobile_capture_session
     SET status = 'complete',
         face_selfie_id = $3,
         hair_left_selfie_id = NULL,
         hair_right_selfie_id = NULL,
         completed_at = now()
     WHERE id = $1 AND user_id = $2 AND status = 'capturing'
     RETURNING id`,
    [id, userId, faceSelfieId],
  );
  if (!result.rowCount) throw new Error("This mobile capture session is no longer active.");
}
