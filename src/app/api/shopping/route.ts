import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { productById, type ProductKind } from "@/lib/product-catalog";
import { deleteShoppingItem, markAchieveVisit, saveShoppingItem, shoppingStateForUser, type ShoppingStatus } from "@/lib/shopping-store";

export const runtime = "nodejs";

const PRODUCT_KINDS = new Set<ProductKind>(["skin", "makeup", "hair"]);
const STATUSES = new Set<ShoppingStatus>(["saved", "cart"]);

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Sign in to view your Product Catalog." }, { status: 401 });
  const state = await shoppingStateForUser(session.user.id);
  return NextResponse.json(state);
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Sign in to save products." }, { status: 401 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action || "");
    if (action === "viewed-achieve") {
      const sourceType = String(body.sourceType || "") as ProductKind;
      const sourceKey = String(body.sourceKey || "").slice(0, 180);
      if (!PRODUCT_KINDS.has(sourceType) || !sourceKey) throw new Error("The Achieve source is invalid.");
      await markAchieveVisit(session.user.id, sourceType, sourceKey);
      return NextResponse.json({ visited: true, sourceKey });
    }
    const productId = String(body.productId || "");
    const sourceType = String(body.sourceType || "") as ProductKind;
    const sourceKey = String(body.sourceKey || "").slice(0, 180);
    const status = String(body.status || "") as ShoppingStatus;
    const product = productById(productId);
    const isShopifyProduct = productId.startsWith("gid://shopify/");
    if (!product && !isShopifyProduct) throw new Error("That product is not in the current Muse catalog.");
    if (!PRODUCT_KINDS.has(sourceType) || (product && product.kind !== sourceType)) throw new Error("That product does not match this routine.");
    if (!sourceKey) throw new Error("The recommendation source is missing.");
    if (!STATUSES.has(status)) throw new Error("Choose whether to save this product or add it to your bag.");
    const item = await saveShoppingItem({ userId: session.user.id, productId, sourceType, sourceKey, status });
    return NextResponse.json({ item });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "That product could not be saved." }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Sign in to edit your Product Catalog." }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!id) return NextResponse.json({ error: "The shopping-list item is missing." }, { status: 400 });
  const removed = await deleteShoppingItem(session.user.id, id);
  return NextResponse.json({ removed });
}
