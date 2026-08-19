import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import type { ProductKind } from "@/lib/product-catalog";
import type { LiveShopifyProduct } from "@/lib/shopify-catalog-types";
import { demoBoardUser } from "@/lib/demo-board-store";
import { shoppingStateForUser } from "@/lib/shopping-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SHOPIFY_CATALOG_ENDPOINT = "https://catalog.shopify.com/api/ucp/mcp";
const SHOPIFY_AGENT_PROFILE = "https://shopify.dev/ucp/agent-profiles/2026-04-08/valid-with-capabilities.json";
const PRODUCT_KINDS = new Set<ProductKind>(["skin", "makeup", "hair"]);

type ShopifyMoney = { amount?: number; currency?: string };
type ShopifyMedia = { type?: string; url?: string; alt_text?: string };
type ShopifyVariant = {
  url?: string;
  checkout_url?: string;
  availability?: { available?: boolean };
  seller?: { name?: string; url?: string };
  media?: ShopifyMedia[];
};
type ShopifyCatalogProduct = {
  id?: string;
  title?: string;
  description?: { plain?: string; html?: string };
  media?: ShopifyMedia[];
  url?: string;
  price_range?: { min?: ShopifyMoney; max?: ShopifyMoney };
  variants?: ShopifyVariant[];
};

function plainText(value: string) {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
}

function priceLabel(money?: ShopifyMoney) {
  if (!money || typeof money.amount !== "number") return "See price";
  const currency = money.currency || "USD";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(money.amount / 100);
  } catch {
    return `${(money.amount / 100).toFixed(2)} ${currency}`;
  }
}

function publicProduct(product: ShopifyCatalogProduct, category = "Shopify beauty"): LiveShopifyProduct | null {
  if (!product.id || !product.title) return null;
  const availableVariant = product.variants?.find((variant) => variant.availability?.available !== false)
    || product.variants?.[0];
  const productUrl = product.url || availableVariant?.url || availableVariant?.checkout_url || availableVariant?.seller?.url || "";
  if (!productUrl.startsWith("http")) return null;
  const image = product.media?.find((media) => media.type === "image" && media.url?.startsWith("https://cdn.shopify.com/"))
    || availableVariant?.media?.find((media) => media.type === "image" && media.url?.startsWith("https://cdn.shopify.com/"));
  return {
    id: product.id,
    category,
    title: product.title,
    description: plainText(product.description?.plain || product.description?.html || "Live product from a Shopify merchant."),
    merchant: availableVariant?.seller?.name || "Shopify merchant",
    price: priceLabel(product.price_range?.min),
    imageUrl: image?.url || null,
    imageAlt: image?.alt_text || product.title,
    productUrl,
    checkoutUrl: availableVariant?.checkout_url || null,
  };
}

async function callShopifyCatalog(name: "search_catalog" | "lookup_catalog", catalog: Record<string, unknown>) {
  const response = await fetch(SHOPIFY_CATALOG_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      id: crypto.randomUUID(),
      params: {
        name,
        arguments: {
          meta: { "ucp-agent": { profile: SHOPIFY_AGENT_PROFILE } },
          catalog,
        },
      },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(18_000),
  });
  if (!response.ok) throw new Error(`Shopify Catalog returned ${response.status}.`);
  const payload = await response.json() as {
    error?: { message?: string };
    result?: { structuredContent?: { products?: ShopifyCatalogProduct[] } };
  };
  if (payload.error) throw new Error(payload.error.message || "Shopify Catalog could not complete the request.");
  return (payload.result?.structuredContent?.products || [])
    .map((product) => publicProduct(product))
    .filter((product): product is LiveShopifyProduct => Boolean(product));
}

function descriptorQuery(tags: string[]) {
  const descriptors = tags
    .map((tag) => tag.toLowerCase().replace(/[^a-z0-9 -]/g, "").trim())
    .filter(Boolean)
    .slice(0, 8)
    .join(" ");
  return descriptors;
}

const PRODUCT_CATEGORIES: Record<ProductKind, Array<{ label: string; query: string }>> = {
  skin: [
    { label: "Cleanser", query: "gentle facial cleanser" },
    { label: "Moisturizer", query: "face moisturizer barrier cream" },
    { label: "Sunscreen", query: "broad spectrum face sunscreen SPF" },
    { label: "Treatment", query: "face treatment serum skincare" },
  ],
  makeup: [
    { label: "Foundation", query: "foundation complexion makeup" },
    { label: "Eyeliner", query: "eye liner eyeliner makeup" },
    { label: "Cheek color", query: "blush bronzer cheek makeup" },
    { label: "Lip color", query: "lipstick lip gloss lip color" },
  ],
  hair: [
    { label: "Shampoo", query: "hair shampoo cleanser" },
    { label: "Conditioner", query: "hair conditioner moisture" },
    { label: "Protection", query: "hair heat protectant leave in" },
    { label: "Styling", query: "hair styling cream serum mousse spray" },
  ],
};

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Sign in to view live products." }, { status: 401 });
  try {
    const url = new URL(request.url);
    const kind = String(url.searchParams.get("kind") || "") as ProductKind;
    if (!PRODUCT_KINDS.has(kind)) throw new Error("Choose a valid beauty category.");
    const directQuery = String(url.searchParams.get("q") || "").replace(/[^a-zA-Z0-9 &+.'/-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
    const categoryLabel = String(url.searchParams.get("category") || "Shopify beauty").replace(/[^a-zA-Z0-9 &+/-]/g, " ").trim().slice(0, 60) || "Shopify beauty";
    if (directQuery) {
      const products = (await callShopifyCatalog("search_catalog", {
        query: directQuery,
        filters: { ships_to: { country: "US" }, available: true },
        context: {
          address_country: "US",
          currency: "USD",
          intent: `Find close product-name or product-type matches for a user's ${kind} product. Prioritize exact brand and title matches when supplied.`,
        },
        pagination: { limit: 12 },
      })).slice(0, 10).map((product) => ({ ...product, category: categoryLabel }));
      return NextResponse.json({ products, provider: "Shopify Global Catalog", query: directQuery }, {
        headers: { "Cache-Control": "private, no-store, max-age=0" },
      });
    }
    const tags = (url.searchParams.get("tags") || "").split(",");
    const excludedIds = new Set(
      (url.searchParams.get("exclude") || "")
        .split("|")
        .filter((id) => id.startsWith("gid://shopify/"))
        .slice(0, 40),
    );
    const descriptors = descriptorQuery(tags);
    const searches = await Promise.allSettled(PRODUCT_CATEGORIES[kind].map(async (category) => ({
      category,
      products: await callShopifyCatalog("search_catalog", {
        query: `${descriptors} ${category.query}`.trim().slice(0, 280),
        filters: { ships_to: { country: "US" }, available: true },
        context: {
          address_country: "US",
          currency: "USD",
          intent: `Find one practical ${category.label.toLowerCase()} product for this ${kind} plan. Return products in this product category, not four versions of the same item type.`,
        },
        pagination: { limit: 12 },
      }),
    })));
    const usedIds = new Set<string>();
    const products = searches.flatMap((search) => {
      if (search.status !== "fulfilled") return [];
      const product = search.value.products.find((candidate) => !usedIds.has(candidate.id) && !excludedIds.has(candidate.id));
      if (!product) return [];
      usedIds.add(product.id);
      return [{ ...product, category: search.value.category.label }];
    }).slice(0, 4);
    return NextResponse.json({ products, provider: "Shopify Global Catalog" }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Live products are unavailable." }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  try {
    const body = await request.json() as { ids?: unknown; demoAccount?: unknown };
    let ids = Array.isArray(body.ids)
      ? body.ids.map(String).filter((id) => id.startsWith("gid://shopify/")).slice(0, 50)
      : [];
    if (!session) {
      const demoUser = await demoBoardUser(String(body.demoAccount || ""));
      if (!demoUser) return NextResponse.json({ error: "Sign in to view saved products." }, { status: 401 });
      const allowed = new Set((await shoppingStateForUser(demoUser.id)).items.map((item) => item.productId));
      ids = ids.filter((id) => allowed.has(id));
    }
    if (!ids.length) return NextResponse.json({ products: [], provider: "Shopify Global Catalog" });
    const products = await callShopifyCatalog("lookup_catalog", {
      ids,
      context: { address_country: "US", currency: "USD" },
    });
    return NextResponse.json({ products, provider: "Shopify Global Catalog" }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Saved products are unavailable." }, { status: 502 });
  }
}
