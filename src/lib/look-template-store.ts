import { get, put } from "@vercel/blob";
import sharp from "sharp";
import { databasePool } from "@/lib/auth";
import type { LookKind } from "@/lib/muse-types";

type LookTemplateRow = {
  look_id: string;
  kind: LookKind;
  status: "generating" | "ready" | "error";
  blob_url: string | null;
  blob_pathname: string | null;
  content_type: string | null;
  access_token: string;
  source_reference_url: string;
  prompt: string;
  error: string | null;
  created_at: Date;
  updated_at: Date;
};

export type GeneratedLookTemplate = {
  lookId: string;
  kind: LookKind;
  blobUrl: string;
  blobPathname: string;
  contentType: string;
  accessToken: string;
};

export type LookTemplateClaim =
  | { state: "claimed"; accessToken: string }
  | { state: "ready"; template: GeneratedLookTemplate }
  | { state: "waiting" };

const GENERATION_STALE_AFTER_MS = 3 * 60 * 1000;
const MAX_TEMPLATE_BYTES = 10 * 1024 * 1024;

function publicTemplate(row: LookTemplateRow): GeneratedLookTemplate | null {
  if (row.status !== "ready" || !row.blob_url || !row.blob_pathname || !row.content_type) return null;
  return {
    lookId: row.look_id,
    kind: row.kind,
    blobUrl: row.blob_url,
    blobPathname: row.blob_pathname,
    contentType: row.content_type,
    accessToken: row.access_token,
  };
}

export function generatedLookTemplateUrl(
  template: Pick<GeneratedLookTemplate, "lookId" | "accessToken">,
  publicBaseUrl: string,
) {
  const url = new URL(`/api/look-templates/${encodeURIComponent(template.lookId)}`, publicBaseUrl);
  url.searchParams.set("token", template.accessToken);
  return url.toString();
}

export async function readyGeneratedLookTemplate(lookId: string, kind: LookKind) {
  const result = await databasePool.query<LookTemplateRow>(
    `SELECT * FROM public.look_generated_template
     WHERE look_id = $1 AND kind = $2 AND status = 'ready'
     LIMIT 1`,
    [lookId, kind],
  );
  return result.rows[0] ? publicTemplate(result.rows[0]) : null;
}

export async function claimGeneratedLookTemplate({
  lookId,
  kind,
  sourceReferenceUrl,
  prompt,
}: {
  lookId: string;
  kind: LookKind;
  sourceReferenceUrl: string;
  prompt: string;
}): Promise<LookTemplateClaim> {
  const accessToken = crypto.randomUUID();
  const inserted = await databasePool.query<LookTemplateRow>(
    `INSERT INTO public.look_generated_template
       (look_id, kind, status, access_token, source_reference_url, prompt)
     VALUES ($1, $2, 'generating', $3, $4, $5)
     ON CONFLICT (look_id) DO NOTHING
     RETURNING *`,
    [lookId, kind, accessToken, sourceReferenceUrl, prompt],
  );
  if (inserted.rows[0]) return { state: "claimed", accessToken };

  const existing = await databasePool.query<LookTemplateRow>(
    `SELECT * FROM public.look_generated_template WHERE look_id = $1 LIMIT 1`,
    [lookId],
  );
  const row = existing.rows[0];
  const ready = row ? publicTemplate(row) : null;
  if (ready && row.kind === kind) return { state: "ready", template: ready };

  const staleBefore = new Date(Date.now() - GENERATION_STALE_AFTER_MS);
  const claimed = await databasePool.query<LookTemplateRow>(
    `UPDATE public.look_generated_template
     SET kind = $2,
         status = 'generating',
         blob_url = NULL,
         blob_pathname = NULL,
         content_type = NULL,
         access_token = $3,
         source_reference_url = $4,
         prompt = $5,
         error = NULL,
         updated_at = now()
     WHERE look_id = $1
       AND (status = 'error' OR updated_at < $6)
     RETURNING *`,
    [lookId, kind, accessToken, sourceReferenceUrl, prompt, staleBefore],
  );
  if (claimed.rows[0]) return { state: "claimed", accessToken };
  return { state: "waiting" };
}

export async function waitForGeneratedLookTemplate(lookId: string, kind: LookKind, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await readyGeneratedLookTemplate(lookId, kind);
    if (ready) return ready;
    const state = await databasePool.query<Pick<LookTemplateRow, "status" | "error">>(
      `SELECT status, error FROM public.look_generated_template WHERE look_id = $1 LIMIT 1`,
      [lookId],
    );
    if (state.rows[0]?.status === "error") {
      throw new Error(state.rows[0].error || "The replacement template could not be generated.");
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("Muse is still rebuilding this look's transfer template. Please try again shortly.");
}

export async function storeGeneratedLookTemplate({
  lookId,
  kind,
  accessToken,
  generatedUrl,
}: {
  lookId: string;
  kind: LookKind;
  accessToken: string;
  generatedUrl: string;
}) {
  const response = await fetch(generatedUrl);
  if (!response.ok) throw new Error("The generated replacement template could not be downloaded.");
  const contentType = response.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  if (!contentType.startsWith("image/")) throw new Error("The replacement template was not an image.");
  const sourceBytes = await response.arrayBuffer();
  if (sourceBytes.byteLength > MAX_TEMPLATE_BYTES) throw new Error("The replacement template is too large to save.");

  const normalized = await sharp(new Uint8Array(sourceBytes), { failOn: "none" })
    .rotate()
    .resize({ width: 1104, height: 1472, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#f4f2f4" })
    .jpeg({ quality: 94, chromaSubsampling: "4:4:4" })
    .toBuffer();
  const safeLookId = lookId.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 180);
  const pathname = `look-templates/${kind}/${safeLookId}.jpg`;
  const blob = await put(pathname, normalized, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "image/jpeg",
  });

  const saved = await databasePool.query<LookTemplateRow>(
    `UPDATE public.look_generated_template
     SET status = 'ready',
         blob_url = $4,
         blob_pathname = $5,
         content_type = $6,
         error = NULL,
         updated_at = now()
     WHERE look_id = $1 AND kind = $2 AND access_token = $3
     RETURNING *`,
    [lookId, kind, accessToken, blob.url, blob.pathname, blob.contentType],
  );
  const template = saved.rows[0] ? publicTemplate(saved.rows[0]) : null;
  if (!template) throw new Error("The replacement template generation lock expired before it could be saved.");
  return template;
}

export async function failGeneratedLookTemplate(lookId: string, accessToken: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  await databasePool.query(
    `UPDATE public.look_generated_template
     SET status = 'error', error = $3, updated_at = now()
     WHERE look_id = $1 AND access_token = $2`,
    [lookId, accessToken, message.slice(0, 1000)],
  );
}

export async function invalidateGeneratedLookTemplate(lookId: string, kind: LookKind, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  await databasePool.query(
    `UPDATE public.look_generated_template
     SET status = 'error', error = $3, updated_at = now()
     WHERE look_id = $1 AND kind = $2`,
    [lookId, kind, message.slice(0, 1000)],
  );
}

export async function readGeneratedLookTemplate(lookId: string, accessToken: string) {
  const result = await databasePool.query<LookTemplateRow>(
    `SELECT * FROM public.look_generated_template
     WHERE look_id = $1 AND access_token = $2 AND status = 'ready'
     LIMIT 1`,
    [lookId, accessToken],
  );
  const row = result.rows[0];
  const template = row ? publicTemplate(row) : null;
  if (!template) return null;
  const blob = await get(template.blobUrl, { access: "private" });
  if (!blob || blob.statusCode !== 200) return null;
  return { template, blob };
}
