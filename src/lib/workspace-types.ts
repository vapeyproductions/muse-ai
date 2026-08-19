import type { AppliedLookProvenance } from "@/lib/look-provenance";

export type SelfieVariant = {
  id: string;
  label: string;
  imageUrl: string;
  sourceUrl?: string;
  file?: File;
  storedSelfieId?: string;
  parentId?: string;
  makeup?: AppliedLookProvenance;
  hair?: AppliedLookProvenance;
  sourceKind?: "upload" | "generated";
  provenanceKnown?: boolean;
  deletable?: boolean;
  demo?: boolean;
};
