import sharp from "sharp";
import { FatalError, RetryableError } from "workflow";
import { readStoredSelfie } from "@/lib/selfie-store";
import { runYouCamMakeupTransfer, runYouCamTask, uploadYouCamFiles } from "@/lib/youcam";
import type { AppliedLookProvenance } from "@/lib/look-provenance";
import {
  claimGeneratedLookTemplate,
  failGeneratedLookTemplate,
  generatedLookTemplateUrl,
  invalidateGeneratedLookTemplate,
  readyGeneratedLookTemplate,
  storeGeneratedLookTemplate,
  waitForGeneratedLookTemplate,
} from "@/lib/look-template-store";

export type TryOnWorkflowInput = {
  userId: string;
  kind: "hair" | "makeup";
  referenceUrl: string;
  publicBaseUrl: string;
  lookDescription: string;
  outputLabel: string;
  resultId: string;
  sourceSelfieId?: string;
  sourceUrl?: string;
  makeup: AppliedLookProvenance | null;
  hair: AppliedLookProvenance | null;
};

export type TryOnWorkflowResult = {
  userId: string;
  resultId: string;
  resultUrl: string;
  outputLabel: string;
  parentId: string | null;
  makeup: AppliedLookProvenance | null;
  hair: AppliedLookProvenance | null;
};

async function normalizeMakeupInput(file: File, role: "source" | "reference") {
  const originalBytes = new Uint8Array(await file.arrayBuffer());
  const normalized = await sharp(originalBytes, { failOn: "none" })
    .rotate()
    .resize({
      width: 1024,
      height: 1024,
      fit: "inside",
      // Many curated references are 450px Pinterest images. The legacy
      // transfer engine rejects some sub-512px inputs as an internal error,
      // so references are normalized upward while source selfies are never
      // artificially enlarged.
      withoutEnlargement: role === "source",
    })
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
    .toBuffer({ resolveWithObject: true });
  console.info("[try-on-workflow] normalized makeup input", {
    role,
    originalBytes: file.size,
    originalType: file.type || "unknown",
    outputBytes: normalized.data.byteLength,
    outputWidth: normalized.info.width,
    outputHeight: normalized.info.height,
  });
  return new File([new Uint8Array(normalized.data)], `${role}.jpg`, { type: "image/jpeg" });
}

function replacementPrompt(kind: "makeup" | "hair", lookDescription: string) {
  const subject = kind === "makeup"
    ? "Recreate only the makeup styling from the reference image on a generic adult beauty model. Preserve the eye makeup, liner, lashes, lip color, blush, finish, and placement."
    : "Recreate only the hairstyle from the reference image on a generic adult beauty model. Preserve the cut, length, part, bangs, texture, volume, and styling.";
  const framing = kind === "makeup"
    ? "Front-facing head-and-shoulders beauty photograph, eyes open, hair tucked away from the face, neutral expression, symmetrical pose, soft even studio light, plain light gray background."
    : "Front-facing portrait with the complete head and entire hairstyle visible from crown to ends, face unobstructed, neutral expression, soft even studio light, plain light gray background.";
  return `${subject} Style description: ${lookDescription}. ${framing} One person only. Photorealistic. No text or watermark.`.slice(0, 790);
}

const GENERATED_REFERENCE_NEGATIVE_PROMPT = [
  "multiple people",
  "profile view",
  "angled face",
  "tilted head",
  "closed eyes",
  "hands on face",
  "face occlusion",
  "cropped head",
  "cropped hair",
  "accessories covering face",
  "text",
  "watermark",
].join(", ");

function directApplicationPrompt(kind: "makeup" | "hair", lookDescription: string) {
  const treatment = kind === "makeup"
    ? "Faithfully copy only the makeup visible in image 2 onto the person in image 1. Match its exact colors, shapes, intensity, placement, liner thickness, lashes, lip color, blush, and finish. Do not exaggerate, editorialize, simplify, or invent any makeup."
    : "Apply only the hairstyle from image 2 to the person in image 1, including the same cut, length, part, bangs, texture, volume, and styling.";
  return [
    "Image 1 is the source portrait and identity. Image 2 is a styling reference only.",
    treatment,
    `Style description: ${lookDescription}.`,
    "Preserve the person from image 1 exactly: identity, facial structure, skin tone, eye color, expression, pose, camera angle, framing, lighting, background, clothing, and every feature unrelated to the requested styling.",
    "Match image 1's exact camera distance and complete head-and-shoulders composition. Do not zoom in, enlarge the face, or crop the forehead, chin, hair, or shoulders.",
    "One person only. Photorealistic. No text or watermark.",
  ].join(" ").slice(0, 790);
}

const DIRECT_APPLICATION_NEGATIVE_PROMPT = [
  "different person",
  "changed identity",
  "changed face shape",
  "changed skin tone",
  "changed eye color",
  "changed expression",
  "changed pose",
  "changed background",
  "changed clothing",
  "exaggerated makeup",
  "graphic editorial makeup",
  "theatrical makeup",
  "face paint",
  "invented makeup colors",
  "oversized eyeliner",
  "white eye shadow",
  "zoomed-in face",
  "close-up crop",
  "cropped forehead",
  "cropped chin",
  "cropped shoulders",
  "multiple people",
  "face distortion",
  "asymmetrical eyes",
  "text",
  "watermark",
].join(", ");

function isTemplateSpecificFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /unknown_internal_error|error_no_face|error_pose|error_face_position|error_face_parsing|error_multiple_people|error_large_face_angle|error_hair|reference is unavailable|did not return a rendered image|did not return a makeup image/i.test(message);
}

function isRetryableServiceFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /timed out|rate limit|\b429\b|\b5\d\d\b/i.test(message);
}

async function generateReplacementReference(input: TryOnWorkflowInput, prompt: string) {
  const response = await fetch(input.referenceUrl);
  if (!response.ok) throw new Error("The assigned template could not be supplied to image generation.");
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) throw new Error("The assigned template is not an image.");
  const source = new File([blob], "look-reference.jpg", { type: blob.type || "image/jpeg" });
  const [sourceFileId] = await uploadYouCamFiles("image-to-image/youcam", [source], "v2.0");
  const generated = await runYouCamTask(
    "image-to-image/youcam",
    {
      src_file_ids: [sourceFileId],
      model: "youcam-image-v2",
      prompt,
      negative_prompt: GENERATED_REFERENCE_NEGATIVE_PROMPT,
      size: "1104*1472",
      prompt_extend: true,
    },
    "v2.0",
    120_000,
  );
  const url = (generated.results as Record<string, unknown> | undefined)?.url;
  if (typeof url !== "string" || !url) {
    throw new Error("Image generation did not return a replacement template.");
  }
  return url;
}

async function generateDirectComposite(
  input: TryOnWorkflowInput,
  sourceFile: File,
  referenceUrl: string,
) {
  const response = await fetch(referenceUrl);
  if (!response.ok) throw new Error("The rebuilt styling reference is unavailable for direct application.");
  const referenceBlob = await response.blob();
  if (!referenceBlob.type.startsWith("image/")) throw new Error("The rebuilt styling reference is not an image.");
  const referenceFile = new File([referenceBlob], "rebuilt-look-reference.jpg", {
    type: referenceBlob.type || "image/jpeg",
  });
  const [sourceFileId, referenceFileId] = await uploadYouCamFiles(
    "image-to-image/youcam",
    [sourceFile, referenceFile],
    "v2.0",
  );
  const generated = await runYouCamTask(
    "image-to-image/youcam",
    {
      src_file_ids: [sourceFileId, referenceFileId],
      model: "youcam-image-v2",
      prompt: directApplicationPrompt(input.kind, input.lookDescription),
      negative_prompt: DIRECT_APPLICATION_NEGATIVE_PROMPT,
      size: "1104*1472",
      prompt_extend: false,
    },
    "v2.0",
    120_000,
  );
  const url = (generated.results as Record<string, unknown> | undefined)?.url;
  if (typeof url !== "string" || !url) {
    throw new Error("Direct look generation did not return an image.");
  }
  return url;
}

async function renderWithYouCam(input: TryOnWorkflowInput): Promise<TryOnWorkflowResult> {
  "use step";

  try {
    let sourceFilePromise: Promise<File>;
    if (input.sourceSelfieId) {
      const sourceSelfieId = input.sourceSelfieId;
      sourceFilePromise = (async () => {
        const stored = await readStoredSelfie(sourceSelfieId, input.userId);
        if (!stored) throw new Error("That saved selfie is unavailable.");
        const storedBlob = await new Response(stored.result.stream).blob();
        return new File([storedBlob], "saved-selfie.jpg", {
          type: stored.result.blob.contentType || stored.row.content_type,
        });
      })();
    } else if (input.sourceUrl) {
      const sourceUrl = input.sourceUrl;
      sourceFilePromise = (async () => {
        const response = await fetch(sourceUrl);
        if (!response.ok) throw new Error("The selected base photo is unavailable.");
        const blob = await response.blob();
        return new File([blob], "source-selfie.jpg", { type: blob.type || "image/jpeg" });
      })();
    } else {
      throw new Error("This branch no longer has a renderable source.");
    }

    const activeLook = input.kind === "makeup" ? input.makeup : input.hair;
    if (!activeLook) throw new Error("The selected look recipe is missing.");
    const lookId = activeLook.lookId;
    const prompt = replacementPrompt(input.kind, input.lookDescription);
    const cachedTemplate = await readyGeneratedLookTemplate(lookId, input.kind);
    const primaryReferenceUrl = cachedTemplate
      ? generatedLookTemplateUrl(cachedTemplate, input.publicBaseUrl)
      : input.referenceUrl;

    const sourceFile = await sourceFilePromise;
    let renderReference: (referenceUrl: string) => Promise<string>;
    if (input.kind === "makeup") {
      const transferSourceFile = await normalizeMakeupInput(sourceFile, "source");
      const [sourceFileId] = await uploadYouCamFiles("mu-trans-rec", [transferSourceFile], "v1.0");
      renderReference = async (referenceUrl: string) => {
        const response = await fetch(referenceUrl);
        if (!response.ok) throw new Error("The selected makeup reference is unavailable.");
        const blob = await response.blob();
        const rawReferenceFile = new File([blob], "makeup-reference.jpg", {
          type: blob.type || "image/jpeg",
        });
        const referenceFile = await normalizeMakeupInput(rawReferenceFile, "reference");
        const [referenceFileId] = await uploadYouCamFiles("mu-trans-rec", [referenceFile], "v1.0");
        return runYouCamMakeupTransfer(sourceFileId, referenceFileId);
      };
    } else {
      const [sourceFileId] = await uploadYouCamFiles("hair-transfer", [sourceFile], "v2.1");
      renderReference = async (referenceUrl: string) => {
        const result = await runYouCamTask(
          "hair-transfer",
          { src_file_id: sourceFileId, ref_file_url: referenceUrl },
          "v2.1",
        );
        const url = (result.results as Record<string, unknown> | undefined)?.url;
        if (typeof url !== "string" || !url) throw new Error("YouCam did not return a rendered image.");
        return url;
      };
    }

    let resultUrl: string;
    try {
      resultUrl = await renderReference(primaryReferenceUrl);
    } catch (templateError) {
      if (isRetryableServiceFailure(templateError) || !isTemplateSpecificFailure(templateError)) throw templateError;
      console.warn("[try-on-workflow] assigned template rejected; generating a canonical replacement", {
        kind: input.kind,
        lookId,
        usedGeneratedTemplate: Boolean(cachedTemplate),
        message: templateError instanceof Error ? templateError.message : String(templateError),
      });
      if (cachedTemplate) {
        await invalidateGeneratedLookTemplate(lookId, input.kind, templateError);
      }

      // Makeup Transfer occasionally rejects otherwise useful references. Apply
      // the original assigned template directly before rebuilding it on a
      // generic model; the original is the most faithful source of color,
      // placement, and intensity for image generation.
      if (input.kind === "makeup") {
        try {
          resultUrl = await generateDirectComposite(input, sourceFile, input.referenceUrl);
          console.info("[try-on-workflow] original makeup template applied through image generation", {
            kind: input.kind,
            lookId,
          });
          return {
            userId: input.userId,
            resultId: input.resultId,
            resultUrl,
            outputLabel: input.outputLabel,
            parentId: input.sourceSelfieId || null,
            makeup: input.makeup,
            hair: input.hair,
          };
        } catch (directOriginalError) {
          console.warn("[try-on-workflow] direct application of original makeup template failed; rebuilding reference", {
            kind: input.kind,
            lookId,
            message: directOriginalError instanceof Error ? directOriginalError.message : String(directOriginalError),
          });
        }
      }

      const claim = await claimGeneratedLookTemplate({
        lookId,
        kind: input.kind,
        sourceReferenceUrl: input.referenceUrl,
        prompt,
      });
      let replacementUrl: string;
      let generationToken: string | null = null;
      if (claim.state === "ready") {
        replacementUrl = generatedLookTemplateUrl(claim.template, input.publicBaseUrl);
      } else if (claim.state === "waiting") {
        const replacement = await waitForGeneratedLookTemplate(lookId, input.kind);
        replacementUrl = generatedLookTemplateUrl(replacement, input.publicBaseUrl);
      } else {
        generationToken = claim.accessToken;
        try {
          replacementUrl = await generateReplacementReference(input, prompt);
        } catch (generationError) {
          await failGeneratedLookTemplate(lookId, generationToken, generationError);
          throw new Error(`replacement template generation failed: ${generationError instanceof Error ? generationError.message : String(generationError)}`);
        }
      }

      try {
        resultUrl = await renderReference(replacementUrl);
      } catch (replacementError) {
        if (generationToken) {
          await failGeneratedLookTemplate(lookId, generationToken, replacementError);
          generationToken = null;
        } else {
          await invalidateGeneratedLookTemplate(lookId, input.kind, replacementError);
        }
        console.warn("[try-on-workflow] rebuilt template rejected; applying it through image generation", {
          kind: input.kind,
          lookId,
          message: replacementError instanceof Error ? replacementError.message : String(replacementError),
        });
        try {
          const directReferenceUrl = input.kind === "makeup" ? input.referenceUrl : replacementUrl;
          resultUrl = await generateDirectComposite(input, sourceFile, directReferenceUrl);
          console.info("[try-on-workflow] direct generated composite completed", {
            kind: input.kind,
            lookId,
          });
        } catch (directError) {
          throw new Error(`direct generated composite failed: ${directError instanceof Error ? directError.message : String(directError)}`);
        }
      }

      if (generationToken) {
        try {
          await storeGeneratedLookTemplate({
            lookId,
            kind: input.kind,
            accessToken: generationToken,
            generatedUrl: replacementUrl,
          });
          console.info("[try-on-workflow] generated replacement promoted to canonical template", {
            kind: input.kind,
            lookId,
          });
        } catch (storageError) {
          await failGeneratedLookTemplate(lookId, generationToken, storageError);
          console.error("[try-on-workflow] render succeeded but canonical replacement could not be saved", {
            kind: input.kind,
            lookId,
            message: storageError instanceof Error ? storageError.message : String(storageError),
          });
        }
      }
    }

    return {
      userId: input.userId,
      resultId: input.resultId,
      resultUrl,
      outputLabel: input.outputLabel,
      parentId: input.sourceSelfieId || null,
      makeup: input.makeup,
      hair: input.hair,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Try-on could not be completed.";
    console.error("[try-on-workflow] YouCam render failed", {
      kind: input.kind,
      message,
    });
    if (isRetryableServiceFailure(error)) {
      throw new RetryableError(message, { retryAfter: "3s" });
    }
    if (/replacement template|generated replacement|image-to-image\/youcam|direct generated composite/i.test(message)) {
      throw new FatalError("Muse could not complete this look through either rendering method. Please try again later.");
    }
    if (isTemplateSpecificFailure(error)) {
      throw new FatalError("YouCam could not read this look's template, and Muse could not replace it. Please try again later.");
    }
    throw new FatalError(message);
  }
}

renderWithYouCam.maxRetries = 1;

export async function tryOnWorkflow(input: TryOnWorkflowInput): Promise<TryOnWorkflowResult> {
  "use workflow";
  return renderWithYouCam(input);
}
