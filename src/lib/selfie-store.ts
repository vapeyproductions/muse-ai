import { del, get, put } from "@vercel/blob";
import { databasePool } from "@/lib/auth";
import type { AppliedLookProvenance } from "@/lib/look-provenance";

export type SelfieSourceKind = "upload" | "generated";

type StoredSelfieRow = {
  id: string;
  user_id: string;
  blob_url: string;
  blob_pathname: string;
  content_type: string;
  label: string;
  source_kind: SelfieSourceKind;
  parent_id: string | null;
  makeup: AppliedLookProvenance | null;
  hair: AppliedLookProvenance | null;
  created_at: Date;
};

export type StoredSelfie = {
  id: string;
  label: string;
  sourceKind: SelfieSourceKind;
  parentId: string | null;
  makeup: AppliedLookProvenance | null;
  hair: AppliedLookProvenance | null;
  contentType: string;
  createdAt: string;
  imageUrl: string;
};

export type StoredAssessmentPhotoSet = {
  face: StoredSelfie;
  hairLeft: StoredSelfie | null;
  hairRight: StoredSelfie | null;
};

const ASSESSMENT_FRONT_LABELS = ["Assessment selfie", "Guided front selfie"] as const;
const ASSESSMENT_LEFT_LABEL = "Assessment left hair angle";
const ASSESSMENT_RIGHT_LABEL = "Assessment right hair angle";

const MAX_STORED_SELFIE_BYTES = 10 * 1024 * 1024;

function publicSelfie(row: StoredSelfieRow): StoredSelfie {
  return {
    id: row.id,
    label: row.label,
    sourceKind: row.source_kind,
    parentId: row.parent_id,
    makeup: row.makeup,
    hair: row.hair,
    contentType: row.content_type,
    createdAt: row.created_at.toISOString(),
    imageUrl: `/api/selfies/${row.id}`,
  };
}

export async function createSelfieRecord({
  id,
  userId,
  blobUrl,
  blobPathname,
  contentType,
  label,
  sourceKind,
  parentId,
  makeup,
  hair,
}: {
  id: string;
  userId: string;
  blobUrl: string;
  blobPathname: string;
  contentType: string;
  label: string;
  sourceKind: SelfieSourceKind;
  parentId?: string | null;
  makeup?: AppliedLookProvenance | null;
  hair?: AppliedLookProvenance | null;
}) {
  const result = await databasePool.query<StoredSelfieRow>(
    `INSERT INTO public.user_selfie
      (id, user_id, blob_url, blob_pathname, content_type, label, source_kind, parent_id, makeup, hair)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb)
     RETURNING *`,
    [
      id,
      userId,
      blobUrl,
      blobPathname,
      contentType,
      label.slice(0, 80) || "Selfie",
      sourceKind,
      parentId ?? null,
      JSON.stringify(makeup ?? null),
      JSON.stringify(hair ?? null),
    ],
  );
  return publicSelfie(result.rows[0]);
}

export async function latestSelfieForUser(userId: string) {
  const result = await databasePool.query<StoredSelfieRow>(
    `SELECT * FROM public.user_selfie
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId],
  );
  return result.rows[0] ? publicSelfie(result.rows[0]) : null;
}

export async function selfiesForUser(userId: string) {
  const result = await databasePool.query<StoredSelfieRow>(
    `SELECT selfie.*
     FROM public.user_selfie AS selfie
     WHERE selfie.user_id = $1
       AND selfie.label NOT IN ($2, $3)
       AND NOT EXISTS (
         SELECT 1
         FROM public.mobile_capture_session AS mobile
         WHERE mobile.user_id = $1
           AND (mobile.hair_left_selfie_id = selfie.id OR mobile.hair_right_selfie_id = selfie.id)
       )
     ORDER BY selfie.created_at DESC`,
    [userId, ASSESSMENT_LEFT_LABEL, ASSESSMENT_RIGHT_LABEL],
  );
  return result.rows.map(publicSelfie);
}

export async function assessmentPhotoSetForUser(userId: string): Promise<StoredAssessmentPhotoSet | null> {
  const frontResult = await databasePool.query<StoredSelfieRow>(
    `SELECT * FROM public.user_selfie
     WHERE user_id = $1
       AND source_kind = 'upload'
       AND label = ANY($2::text[])
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId, [...ASSESSMENT_FRONT_LABELS]],
  );
  const frontRow = frontResult.rows[0];
  if (!frontRow) return null;

  const mobileResult = await databasePool.query<{
    hair_left_selfie_id: string | null;
    hair_right_selfie_id: string | null;
  }>(
    `SELECT hair_left_selfie_id, hair_right_selfie_id
     FROM public.mobile_capture_session
     WHERE user_id = $1 AND face_selfie_id = $2 AND status = 'complete'
     ORDER BY completed_at DESC NULLS LAST
     LIMIT 1`,
    [userId, frontRow.id],
  );

  let hairLeft: StoredSelfie | null = null;
  let hairRight: StoredSelfie | null = null;
  const mobile = mobileResult.rows[0];
  if (mobile) {
    [hairLeft, hairRight] = await Promise.all([
      mobile.hair_left_selfie_id ? selfieForUser(mobile.hair_left_selfie_id, userId) : null,
      mobile.hair_right_selfie_id ? selfieForUser(mobile.hair_right_selfie_id, userId) : null,
    ]);
  } else {
    const sideResult = await databasePool.query<StoredSelfieRow>(
      `SELECT * FROM public.user_selfie
       WHERE user_id = $1
         AND parent_id = $2
         AND label IN ($3, $4)
       ORDER BY created_at DESC`,
      [userId, frontRow.id, ASSESSMENT_LEFT_LABEL, ASSESSMENT_RIGHT_LABEL],
    );
    const leftRow = sideResult.rows.find((row) => row.label === ASSESSMENT_LEFT_LABEL);
    const rightRow = sideResult.rows.find((row) => row.label === ASSESSMENT_RIGHT_LABEL);
    hairLeft = leftRow ? publicSelfie(leftRow) : null;
    hairRight = rightRow ? publicSelfie(rightRow) : null;
  }

  return { face: publicSelfie(frontRow), hairLeft, hairRight };
}

export async function selfieRowForUser(id: string, userId: string) {
  const result = await databasePool.query<StoredSelfieRow>(
    `SELECT * FROM public.user_selfie WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [id, userId],
  );
  return result.rows[0] ?? null;
}

export async function selfieForUser(id: string, userId: string) {
  const row = await selfieRowForUser(id, userId);
  return row ? publicSelfie(row) : null;
}

export async function updateSelfieProvenance(
  id: string,
  userId: string,
  makeup: AppliedLookProvenance | null,
  hair: AppliedLookProvenance | null,
) {
  const result = await databasePool.query<StoredSelfieRow>(
    `UPDATE public.user_selfie
     SET makeup = $3::jsonb, hair = $4::jsonb
     WHERE id = $1 AND user_id = $2
     RETURNING *`,
    [id, userId, JSON.stringify(makeup), JSON.stringify(hair)],
  );
  return result.rows[0] ? publicSelfie(result.rows[0]) : null;
}

export async function readStoredSelfie(id: string, userId: string) {
  const row = await selfieRowForUser(id, userId);
  if (!row) return null;
  const result = await get(row.blob_url, { access: "private" });
  if (!result || result.statusCode !== 200) return null;
  return { row, result };
}

export async function deleteStoredSelfie(id: string, userId: string) {
  const row = await selfieRowForUser(id, userId);
  if (!row) return "not-found" as const;
  if (row.source_kind === "upload" && ASSESSMENT_FRONT_LABELS.includes(row.label as typeof ASSESSMENT_FRONT_LABELS[number])) {
    const currentAssessment = await databasePool.query<{ id: string }>(
      `SELECT id FROM public.user_selfie
       WHERE user_id = $1
         AND source_kind = 'upload'
         AND label = ANY($2::text[])
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId, [...ASSESSMENT_FRONT_LABELS]],
    );
    if (currentAssessment.rows[0]?.id === id) return "protected" as const;
  }
  const client = await databasePool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE public.user_selfie SET parent_id = $3 WHERE parent_id = $1 AND user_id = $2`,
      [id, userId, row.parent_id],
    );
    await client.query(`DELETE FROM public.user_selfie WHERE id = $1 AND user_id = $2`, [id, userId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  try {
    await del(row.blob_url);
  } catch (error) {
    console.error("Deleted selfie record but could not remove its blob", { id, error });
  }
  return "removed" as const;
}

export async function clearCurrentAssessmentForUser(userId: string) {
  const result = await databasePool.query<StoredSelfieRow>(
    `SELECT * FROM public.user_selfie
     WHERE user_id = $1
       AND source_kind = 'upload'
       AND label = ANY($2::text[])
     ORDER BY created_at DESC`,
    [userId, [...ASSESSMENT_FRONT_LABELS]],
  );
  const current = result.rows[0];
  if (!current) return false;
  const client = await databasePool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE public.user_selfie
       SET label = 'Previous assessment selfie'
       WHERE user_id = $1
         AND source_kind = 'upload'
         AND label = ANY($2::text[])
         AND id <> $3`,
      [userId, [...ASSESSMENT_FRONT_LABELS], current.id],
    );
    await client.query(
      `DELETE FROM public.mobile_capture_session WHERE user_id = $1 AND face_selfie_id = $2`,
      [userId, current.id],
    );
    await client.query(
      `UPDATE public.user_selfie SET parent_id = $3 WHERE parent_id = $1 AND user_id = $2`,
      [current.id, userId, current.parent_id],
    );
    await client.query(
      `DELETE FROM public.user_selfie WHERE id = $1 AND user_id = $2`,
      [current.id, userId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  try {
    await del(current.blob_url);
  } catch (error) {
    console.error("Cleared assessment selfie record but could not remove its blob", { id: current.id, error });
  }
  return true;
}

export async function storeUploadedSelfie(file: File, userId: string, label: string, parentId?: string | null) {
  const id = crypto.randomUUID();
  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const pathname = `selfies/${userId}/${id}.${extension}`;
  const blob = await put(pathname, file, {
    access: "private",
    addRandomSuffix: false,
    contentType: file.type,
  });
  try {
    return await createSelfieRecord({
      id,
      userId,
      blobUrl: blob.url,
      blobPathname: blob.pathname,
      contentType: blob.contentType,
      label,
      sourceKind: "upload",
      parentId,
    });
  } catch (error) {
    await del(blob.url);
    throw error;
  }
}

export async function storeGeneratedSelfie({
  sourceUrl,
  userId,
  label,
  parentId,
  id: requestedId,
  makeup,
  hair,
}: {
  sourceUrl: string;
  userId: string;
  label: string;
  parentId?: string | null;
  id?: string;
  makeup?: AppliedLookProvenance | null;
  hair?: AppliedLookProvenance | null;
}) {
  if (requestedId) {
    const cached = await selfieForUser(requestedId, userId);
    if (cached) {
      const updated = await updateSelfieProvenance(requestedId, userId, makeup ?? null, hair ?? null);
      return updated || cached;
    }
  }
  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error("The generated selfie could not be saved.");
  const contentType = response.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  if (!contentType.startsWith("image/")) throw new Error("The generated result was not an image.");
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_STORED_SELFIE_BYTES) throw new Error("The generated selfie is too large to save.");

  const id = requestedId || crypto.randomUUID();
  const extension = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
  const pathname = `selfies/${userId}/${id}.${extension}`;
  const blob = await put(pathname, bytes, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: Boolean(requestedId),
    contentType,
  });
  try {
    return await createSelfieRecord({
      id,
      userId,
      blobUrl: blob.url,
      blobPathname: blob.pathname,
      contentType: blob.contentType,
      label,
      sourceKind: "generated",
      parentId,
      makeup,
      hair,
    });
  } catch (error) {
    if (requestedId) {
      const cached = await selfieForUser(requestedId, userId);
      if (cached) return cached;
    }
    await del(blob.url);
    throw error;
  }
}
