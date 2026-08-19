import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { fallbackProductFit } from "@/lib/product-requirements";
import { findOwnedProduct, getCachedProductFit, recordProductInteraction, saveProductFit } from "@/lib/product-profile-store";
import type { ProductDomain, ProductRequirement } from "@/lib/product-profile-types";

export const runtime = "nodejs";
const DOMAINS = new Set<ProductDomain>(["skin", "makeup", "hair"]);

function safeRequirement(value: unknown): ProductRequirement {
  if (!value || typeof value !== "object") throw new Error("The product requirement is missing.");
  const raw = value as Record<string, unknown>;
  const domain = String(raw.domain || "") as ProductDomain;
  if (!DOMAINS.has(domain)) throw new Error("The product requirement is invalid.");
  return {
    id: String(raw.id || "").slice(0, 180),
    domain,
    subcategory: String(raw.subcategory || "").slice(0, 80),
    label: String(raw.label || "").slice(0, 180),
    description: String(raw.description || "").slice(0, 600),
    desiredTraits: Array.isArray(raw.desiredTraits) ? raw.desiredTraits.map(String).slice(0, 12) : [],
    avoidTraits: Array.isArray(raw.avoidTraits) ? raw.avoidTraits.map(String).slice(0, 12) : [],
    searchQuery: String(raw.searchQuery || "").slice(0, 180),
  };
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Sign in to assess your product." }, { status: 401 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const ownedProductId = String(body.ownedProductId || "");
    const sourceKey = String(body.sourceKey || "").slice(0, 180);
    const requirement = safeRequirement(body.requirement);
    if (!ownedProductId || !sourceKey || !requirement.id) throw new Error("The product assessment context is incomplete.");
    const owned = await findOwnedProduct(session.user.id, ownedProductId);
    if (!owned) throw new Error("That product is no longer in Your Owned Products.");
    const cached = await getCachedProductFit(session.user.id, owned.id, requirement.id, sourceKey);
    if (cached) return NextResponse.json({ assessment: cached });
    const assessment = fallbackProductFit(owned, requirement, sourceKey);
    await saveProductFit(session.user.id, assessment);
    await recordProductInteraction(session.user.id, "owned_product_assessed", {
      ownedProductId: owned.id,
      shopifyProductId: owned.shopifyProductId,
      sourceKey,
      requirementId: requirement.id,
      metadata: { score: assessment.score, verdict: assessment.verdict, model: assessment.model },
    });
    return NextResponse.json({ assessment });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The product could not be assessed." }, { status: 400 });
  }
}
