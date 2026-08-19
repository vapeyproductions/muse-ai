"use client";

import type { AppliedLookProvenance } from "@/lib/look-provenance";

export type PersistedSelfie = {
  id: string;
  label: string;
  sourceKind: "upload" | "generated";
  parentId: string | null;
  contentType: string;
  createdAt: string;
  imageUrl: string;
  makeup: AppliedLookProvenance | null;
  hair: AppliedLookProvenance | null;
  deletable?: boolean;
};

export type AssessmentPhotoRole = "face" | "hairLeft" | "hairRight";

export type LoadedAssessmentPhoto = {
  selfie: PersistedSelfie;
  file: File;
  preview: string;
};

export type LoadedAssessmentPhotoSet = {
  face: LoadedAssessmentPhoto;
  hairLeft?: LoadedAssessmentPhoto;
  hairRight?: LoadedAssessmentPhoto;
};

const STORAGE_TARGET_BYTES = 3.5 * 1024 * 1024;

async function canvasBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("The selfie could not be prepared for storage."));
    }, "image/jpeg", quality);
  });
}

export async function prepareSelfieForStorage(file: File) {
  if (file.size <= STORAGE_TARGET_BYTES && ["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    return file;
  }

  const bitmap = await createImageBitmap(file);
  const longestSide = Math.max(bitmap.width, bitmap.height);
  const scale = Math.min(1, 1800 / longestSide);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("The selfie could not be prepared for storage.");
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  let quality = .9;
  let blob = await canvasBlob(canvas, quality);
  while (blob.size > STORAGE_TARGET_BYTES && quality > .55) {
    quality -= .1;
    blob = await canvasBlob(canvas, quality);
  }
  if (blob.size > STORAGE_TARGET_BYTES) throw new Error("This selfie is too large to save permanently.");
  return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "selfie"}.jpg`, {
    type: "image/jpeg",
    lastModified: file.lastModified,
  });
}

export async function saveSelfieToMuse(
  file: File,
  label: string,
  options?: { assessmentRole?: AssessmentPhotoRole; parentId?: string },
) {
  const storageFile = await prepareSelfieForStorage(file);
  const form = new FormData();
  form.append("file", storageFile);
  form.append("label", label);
  if (options?.assessmentRole) form.append("assessmentRole", options.assessmentRole);
  if (options?.parentId) form.append("parentId", options.parentId);
  const response = await fetch("/api/selfies", { method: "POST", body: form });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "The selfie could not be saved.");
  return payload.selfie as PersistedSelfie;
}

export async function loadMuseSelfieFile(selfie: PersistedSelfie): Promise<LoadedAssessmentPhoto> {
  const imageResponse = await fetch(selfie.imageUrl);
  if (!imageResponse.ok) throw new Error("Saved selfie unavailable.");
  const blob = await imageResponse.blob();
  const extension = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
  const file = new File([blob], `saved-selfie.${extension}`, { type: blob.type });
  return { selfie, file, preview: URL.createObjectURL(blob) };
}

export async function loadMuseSelfies() {
  const response = await fetch("/api/selfies", { cache: "no-store" });
  if (response.status === 404) return [];
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Saved selfies unavailable.");
  return (payload.selfies || [payload.selfie]) as PersistedSelfie[];
}

export async function loadLatestAssessmentFacePhoto(): Promise<LoadedAssessmentPhoto | null> {
  const response = await fetch("/api/selfies", { cache: "no-store" });
  if (response.status === 404) return null;
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Saved assessment photo unavailable.");
  const face = (payload.assessmentPhotos as { face?: PersistedSelfie } | null)?.face;
  return face ? loadMuseSelfieFile(face) : null;
}

export async function deleteMuseSelfie(id: string) {
  const response = await fetch(`/api/selfies/${encodeURIComponent(id)}`, { method: "DELETE" });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "This look could not be deleted.");
}

export async function loadLatestAssessmentPhotoSet(): Promise<LoadedAssessmentPhotoSet | null> {
  const response = await fetch("/api/selfies", { cache: "no-store" });
  if (response.status === 404) return null;
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Saved assessment photos unavailable.");
  const photos = payload.assessmentPhotos as {
    face: PersistedSelfie;
    hairLeft: PersistedSelfie | null;
    hairRight: PersistedSelfie | null;
  } | null;
  if (!photos?.face) return null;
  const [face, hairLeft, hairRight] = await Promise.all([
    loadMuseSelfieFile(photos.face),
    photos.hairLeft ? loadMuseSelfieFile(photos.hairLeft) : null,
    photos.hairRight ? loadMuseSelfieFile(photos.hairRight) : null,
  ]);
  return {
    face,
    ...(hairLeft ? { hairLeft } : {}),
    ...(hairRight ? { hairRight } : {}),
  };
}

export async function loadLatestMuseSelfie() {
  const selfies = await loadMuseSelfies();
  const selfie = selfies.find((item) => item.sourceKind === "upload") || selfies[0];
  return selfie ? loadMuseSelfieFile(selfie) : null;
}
