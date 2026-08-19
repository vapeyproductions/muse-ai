import type { LookKind } from "@/lib/muse-types";

export type AppliedLookProvenance = {
  kind: LookKind;
  lookId: string;
  lookLabel: string;
  museName: string;
  selectedAssetId: string;
  templateAssetId: string;
};

export function isAppliedLookProvenance(value: unknown, kind?: LookKind): value is AppliedLookProvenance {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<AppliedLookProvenance>;
  return (item.kind === "makeup" || item.kind === "hair")
    && (!kind || item.kind === kind)
    && [item.lookId, item.lookLabel, item.museName, item.selectedAssetId, item.templateAssetId]
      .every((field) => typeof field === "string" && field.length > 0 && field.length <= 180);
}
