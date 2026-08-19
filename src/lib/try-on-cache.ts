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
  // Makeup fidelity v2 applies the original assigned reference directly when
  // legacy transfer rejects it. Keep old renders in the user's library, but do
  // not reuse them for a new request made against the corrected pipeline.
  const pipelineVersion = kind === "makeup" ? "makeup-fidelity-v2" : "hair-v1";
  const hex = createHash("sha256")
    .update(["muse-try-on-v1", pipelineVersion, userId, sourceKey, kind, referenceUrl, nonce].join("\u0000"))
    .digest("hex")
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}
