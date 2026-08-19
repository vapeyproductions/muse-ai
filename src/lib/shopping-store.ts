import { databasePool } from "@/lib/auth";
import { productById, type ProductKind } from "@/lib/product-catalog";

export type ShoppingStatus = "saved" | "cart";

export type ShoppingItem = {
  id: string;
  productId: string;
  sourceType: ProductKind;
  sourceKey: string;
  status: ShoppingStatus;
  createdAt: string;
  updatedAt: string;
};

type ShoppingRow = {
  id: string;
  product_id: string;
  source_type: ProductKind;
  source_key: string;
  status: ShoppingStatus;
  created_at: Date;
  updated_at: Date;
};

function publicItem(row: ShoppingRow): ShoppingItem {
  return {
    id: row.id,
    productId: row.product_id,
    sourceType: row.source_type,
    sourceKey: row.source_key,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function shoppingStateForUser(userId: string) {
  const [itemsResult, eventResult] = await Promise.all([
    databasePool.query<ShoppingRow>(
      `SELECT id, product_id, source_type, source_key, status, created_at, updated_at
       FROM public.user_shopping_item
       WHERE user_id = $1
       ORDER BY updated_at DESC`,
      [userId],
    ),
    databasePool.query<{ product_id: string; event_type: string; source_key: string; event_count: string }>(
      `SELECT product_id, event_type, source_key, COUNT(*)::text AS event_count
       FROM public.user_recommendation_event
       WHERE user_id = $1
       GROUP BY product_id, event_type, source_key`,
      [userId],
    ),
  ]);
  const affinityTags: Record<string, number> = {};
  const visitedSourceKeys = new Set<string>();
  eventResult.rows.forEach((event) => {
    if (event.event_type === "viewed" && event.product_id === "achieve-mode") {
      visitedSourceKeys.add(event.source_key);
      return;
    }
    const product = productById(event.product_id);
    if (!product) return;
    const weight = event.event_type === "cart" ? 3 : event.event_type === "saved" ? 1.5 : event.event_type === "removed" ? -.75 : .25;
    product.tags.forEach((tag) => {
      affinityTags[tag] = (affinityTags[tag] || 0) + Number(event.event_count) * weight;
    });
  });
  return { items: itemsResult.rows.map(publicItem), affinityTags, visitedSourceKeys: [...visitedSourceKeys] };
}

export async function markAchieveVisit(userId: string, sourceType: ProductKind, sourceKey: string) {
  await databasePool.query(
    `INSERT INTO public.user_recommendation_event
      (user_id, product_id, event_type, source_type, source_key)
     SELECT $1, 'achieve-mode', 'viewed', $2, $3
     WHERE NOT EXISTS (
       SELECT 1 FROM public.user_recommendation_event
       WHERE user_id = $1 AND product_id = 'achieve-mode' AND event_type = 'viewed' AND source_key = $3
     )`,
    [userId, sourceType, sourceKey],
  );
}

export async function saveShoppingItem({
  userId,
  productId,
  sourceType,
  sourceKey,
  status,
}: {
  userId: string;
  productId: string;
  sourceType: ProductKind;
  sourceKey: string;
  status: ShoppingStatus;
}) {
  const client = await databasePool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<ShoppingRow>(
      `INSERT INTO public.user_shopping_item
        (id, user_id, product_id, source_type, source_key, status, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (user_id, product_id, source_type, source_key) DO UPDATE SET
         status = EXCLUDED.status,
         updated_at = now()
       RETURNING id, product_id, source_type, source_key, status, created_at, updated_at`,
      [crypto.randomUUID(), userId, productId, sourceType, sourceKey, status],
    );
    await client.query(
      `INSERT INTO public.user_recommendation_event
        (user_id, product_id, event_type, source_type, source_key)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, productId, status, sourceType, sourceKey],
    );
    await client.query("COMMIT");
    return publicItem(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteShoppingItem(userId: string, id: string) {
  const result = await databasePool.query<ShoppingRow>(
    `DELETE FROM public.user_shopping_item
     WHERE id = $1 AND user_id = $2
     RETURNING id, product_id, source_type, source_key, status, created_at, updated_at`,
    [id, userId],
  );
  const removed = result.rows[0];
  if (!removed) return false;
  await databasePool.query(
    `INSERT INTO public.user_recommendation_event
      (user_id, product_id, event_type, source_type, source_key)
     VALUES ($1, $2, 'removed', $3, $4)`,
    [userId, removed.product_id, removed.source_type, removed.source_key],
  );
  return true;
}
