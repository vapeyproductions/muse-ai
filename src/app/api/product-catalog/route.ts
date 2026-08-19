import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listOwnedProducts, recordProductInteraction, removeOwnedProduct, upsertOwnedProduct } from "@/lib/product-profile-store";
import { PRODUCT_SUBCATEGORIES, type ProductDomain } from "@/lib/product-profile-types";
import type { LiveShopifyProduct } from "@/lib/shopify-catalog-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DOMAINS = new Set<ProductDomain>(["skin", "makeup", "hair"]);

function validSubcategory(domain: ProductDomain, value: string) {
  return PRODUCT_SUBCATEGORIES[domain].some((category) => category.id === value);
}

function safeProduct(value: unknown): LiveShopifyProduct {
  if (!value || typeof value !== "object") throw new Error("Select a valid Shopify product.");
  const raw = value as Record<string, unknown>;
  const id = String(raw.id || "");
  const title = String(raw.title || "").trim();
  const productUrl = String(raw.productUrl || "");
  if (!id.startsWith("gid://shopify/") || !title || !productUrl.startsWith("http")) throw new Error("Select a valid Shopify product.");
  return {
    id,
    category: String(raw.category || "Beauty").slice(0, 100),
    title: title.slice(0, 300),
    description: String(raw.description || "").slice(0, 1200),
    merchant: String(raw.merchant || "Shopify merchant").slice(0, 180),
    price: String(raw.price || "See price").slice(0, 80),
    imageUrl: String(raw.imageUrl || "").startsWith("https://") ? String(raw.imageUrl) : null,
    imageAlt: String(raw.imageAlt || title).slice(0, 300),
    productUrl,
    checkoutUrl: String(raw.checkoutUrl || "").startsWith("https://") ? String(raw.checkoutUrl) : null,
  };
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Sign in to view your Product Catalog." }, { status: 401 });
  const products = await listOwnedProducts(session.user.id);
  return NextResponse.json({ products }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Sign in to update your Product Catalog." }, { status: 401 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action || "add-owned");
    if (action === "interaction") {
      await recordProductInteraction(session.user.id, String(body.eventType || "viewed").slice(0, 80), {
        ownedProductId: body.ownedProductId ? String(body.ownedProductId) : null,
        shopifyProductId: body.shopifyProductId ? String(body.shopifyProductId) : null,
        sourceKey: body.sourceKey ? String(body.sourceKey).slice(0, 180) : null,
        requirementId: body.requirementId ? String(body.requirementId).slice(0, 180) : null,
        metadata: body.metadata && typeof body.metadata === "object" ? body.metadata as Record<string, unknown> : {},
      });
      return NextResponse.json({ recorded: true });
    }
    const domain = String(body.domain || "") as ProductDomain;
    const subcategory = String(body.subcategory || "");
    if (!DOMAINS.has(domain) || !validSubcategory(domain, subcategory)) throw new Error("Choose a valid product category.");
    const product = safeProduct(body.product);
    const attributes = Array.isArray(body.attributes) ? body.attributes.map(String).map((value) => value.slice(0, 80)).slice(0, 30) : [];
    const ownedProduct = await upsertOwnedProduct(session.user.id, product, domain, subcategory, attributes);
    await recordProductInteraction(session.user.id, "owned_product_added", {
      ownedProductId: ownedProduct.id,
      shopifyProductId: product.id,
      sourceKey: body.sourceKey ? String(body.sourceKey).slice(0, 180) : null,
      requirementId: body.requirementId ? String(body.requirementId).slice(0, 180) : null,
      metadata: { domain, subcategory, origin: String(body.origin || "catalog-search").slice(0, 80) },
    });
    return NextResponse.json({ product: ownedProduct });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The product could not be saved." }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Sign in to edit your Product Catalog." }, { status: 401 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const ownedProductId = String(body.ownedProductId || "");
    const rawRating = body.rating === null || body.rating === undefined ? null : Number(body.rating);
    if (!ownedProductId) throw new Error("Choose a product to remove.");
    if (rawRating !== null && (!Number.isInteger(rawRating) || rawRating < 1 || rawRating > 5)) throw new Error("Ratings must be between one and five stars.");
    const removed = await removeOwnedProduct(session.user.id, ownedProductId, {
      rating: rawRating,
      neverTried: Boolean(body.neverTried),
      feedbackTags: Array.isArray(body.feedbackTags) ? body.feedbackTags.map(String).map((value) => value.slice(0, 80)).slice(0, 20) : [],
    });
    return NextResponse.json({ removed });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The product could not be removed." }, { status: 400 });
  }
}
