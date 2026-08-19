import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { auth } from "@/lib/auth";
import { tryOnResultId } from "@/lib/try-on-cache";
import { signTryOnJob } from "@/lib/try-on-job";
import { selfieForUser, storeUploadedSelfie, updateSelfieProvenance } from "@/lib/selfie-store";
import { tryOnWorkflow } from "@/workflows/try-on";
import { isAppliedLookProvenance, type AppliedLookProvenance } from "@/lib/look-provenance";
import catalogData from "@/data/muse-catalog.json";
import type { LookKind, MuseCatalog } from "@/lib/muse-types";

export const runtime = "nodejs";
export const maxDuration = 30;

function allowedReference(value: string, requestOrigin: string) {
  try {
    const url = new URL(value);
    const origin = new URL(requestOrigin);
    return url.protocol === "https:" && (
      url.hostname === "i.pinimg.com"
      || url.origin === origin.origin
    );
  } catch {
    return false;
  }
}

function allowedSource(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && [
      "i.pinimg.com",
      "yce-us.s3-accelerate.amazonaws.com",
    ].includes(url.hostname);
  } catch {
    return false;
  }
}

function lookFromForm(form: FormData, name: "makeup" | "hair"): AppliedLookProvenance | null {
  const raw = String(form.get(name) || "").trim();
  if (!raw || raw === "null") return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`The ${name} look recipe is invalid.`);
  }
  if (!isAppliedLookProvenance(value, name)) throw new Error(`The ${name} look recipe is invalid.`);
  return value;
}

function trustedCatalogLook(
  kind: LookKind,
  provenance: AppliedLookProvenance,
  referenceUrl: string,
  requestOrigin: string,
) {
  const catalog = catalogData as MuseCatalog;
  const muse = catalog.muses.find((candidate) => candidate.name === provenance.museName);
  const look = muse?.looks.find((candidate) => candidate.id === provenance.lookId && candidate.kind === kind);
  if (!muse || !look || look.templateAssetId !== provenance.templateAssetId) {
    throw new Error("That look is no longer in the Muse catalog.");
  }
  const selectedAssetIds = new Set([look.templateAssetId, ...look.galleryAssetIds]);
  if (!selectedAssetIds.has(provenance.selectedAssetId)) {
    throw new Error("That inspiration image is not assigned to this look.");
  }
  const templateAsset = catalog.assets[look.templateAssetId];
  if (!templateAsset) throw new Error("That look does not have a transfer template.");
  const expectedReferenceUrl = new URL(
    templateAsset.transferImageUrl || templateAsset.imageUrl,
    requestOrigin,
  ).toString();
  if (new URL(referenceUrl).toString() !== expectedReferenceUrl) {
    throw new Error("That reference image is not assigned to this look.");
  }
  return {
    lookDescription: [look.label, ...look.descriptors].filter(Boolean).join(", ").slice(0, 500),
  };
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return NextResponse.json({ error: "Sign in to generate a try-on." }, { status: 401 });
  }

  if (!process.env.YOUCAM_API_KEY) {
    return NextResponse.json({
      mode: "demo",
      status: "complete",
      message: "The experience is ready. Add YOUCAM_API_KEY in Vercel to generate live try-ons.",
    });
  }

  try {
    const form = await request.formData();
    const requestOrigin = new URL(request.url).origin;
    const photo = form.get("photo");
    const sourceUrl = String(form.get("sourceUrl") || "");
    const requestedSelfieId = String(form.get("storedSelfieId") || "");
    const outputLabel = String(form.get("outputLabel") || "Generated look").slice(0, 80);
    const kind = form.get("kind");
    const referenceUrl = String(form.get("referenceUrl") || "");
    const forceFresh = form.get("forceFresh") === "true";
    let makeup = lookFromForm(form, "makeup");
    let hair = lookFromForm(form, "hair");
    const hasPhoto = photo instanceof File && photo.size > 0;
    const hasSource = allowedSource(sourceUrl);

    if (kind !== "hair" && kind !== "makeup") throw new Error("Unknown try-on type.");
    if (kind === "makeup" && !makeup) throw new Error("Choose a makeup reference first.");
    if (kind === "hair" && !hair) throw new Error("Choose a hair reference first.");
    if (!allowedReference(referenceUrl, requestOrigin)) throw new Error("That reference image is not in the Muse catalog.");
    if (hasPhoto && photo.size > 10 * 1024 * 1024) throw new Error("Your selfie must be under 10 MB.");
    const activeLook = kind === "makeup" ? makeup : hair;
    if (!activeLook) throw new Error("Choose a look first.");
    const { lookDescription } = trustedCatalogLook(kind, activeLook, referenceUrl, requestOrigin);

    let sourceSelfieId = requestedSelfieId;
    let workflowSourceUrl = hasSource ? sourceUrl : undefined;

    if (sourceSelfieId) {
      const stored = await selfieForUser(sourceSelfieId, session.user.id);
      if (!stored) throw new Error("That saved selfie is unavailable.");
      if (kind === "makeup" && stored.makeup) throw new Error("Choose a selfie that does not already have makeup.");
      if (kind === "hair" && stored.hair) throw new Error("Choose a selfie that does not already have a hairstyle.");
      if (kind === "makeup") hair = stored.hair;
      if (kind === "hair") makeup = stored.makeup;
      workflowSourceUrl = undefined;
    } else if (hasPhoto) {
      const savedSource = await storeUploadedSelfie(photo, session.user.id, `${outputLabel} source`);
      sourceSelfieId = savedSource.id;
      workflowSourceUrl = undefined;
    } else if (!workflowSourceUrl) {
      throw new Error("Add a selfie or choose a renderable existing branch first.");
    }

    const sourceKey = sourceSelfieId ? `selfie:${sourceSelfieId}` : `url:${workflowSourceUrl}`;
    const resultId = tryOnResultId({
      userId: session.user.id,
      sourceKey,
      kind,
      referenceUrl,
      forceFresh,
    });

    if (!forceFresh) {
      const cached = await selfieForUser(resultId, session.user.id);
      if (cached) {
        const updated = await updateSelfieProvenance(resultId, session.user.id, makeup, hair);
        return NextResponse.json({
          status: "complete",
          cached: true,
          resultUrl: (updated || cached).imageUrl,
          storedSelfieId: (updated || cached).id,
        });
      }
    }

    const run = await start(tryOnWorkflow, [{
      userId: session.user.id,
      kind,
      referenceUrl,
      publicBaseUrl: requestOrigin,
      lookDescription,
      outputLabel,
      resultId,
      sourceSelfieId: sourceSelfieId || undefined,
      sourceUrl: workflowSourceUrl,
      makeup,
      hair,
    }]);
    const jobToken = signTryOnJob(run.runId, session.user.id);

    return NextResponse.json({
      status: "queued",
      cached: false,
      jobId: run.runId,
      jobToken,
    }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Try-on could not be started." }, { status: 400 });
  }
}
