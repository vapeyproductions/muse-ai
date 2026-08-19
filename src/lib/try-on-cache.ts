import { createHash } from "node:crypto";

export function tryOnResultId({
  userId,
  sourceKey,
  kind,
  referenceUrl,
  forceFresh,
}: {
  userId: string;
  sourceKey: string;
  kind: "hair" | "makeup";
  referenceUrl: string;
  forceFresh: boolean;
}) {
  const nonce = forceFresh ? crypto.randomUUID() : "reuse";
  // Makeup preserve-hair v3 never falls back to whole-image generation. Keep
  // historical renders in the user's library, but never reuse one produced by
  // the earlier fallback that could replace an existing hairstyle.
  const pipelineVersion = kind === "makeup" ? "makeup-preserve-hair-v3" : "hair-v1";
  const hex = createHash("sha256")
    .update(["muse-try-on-v1", pipelineVersion, userId, sourceKey, kind, referenceUrl, nonce].join("\u0000"))
    .digest("hex")
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}
