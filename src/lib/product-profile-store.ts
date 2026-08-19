import { databasePool } from "@/lib/auth";
import type { LiveShopifyProduct } from "@/lib/shopify-catalog-types";
import type { OwnedProduct, ProductDomain, ProductFitAssessment } from "@/lib/product-profile-types";

type OwnedRow = {
  id: string;
  shopify_product_id: string;
  domain: ProductDomain;
  subcategory: string;
  title: string;
  merchant: string;
  image_url: string | null;
  image_alt: string;
  product_url: string;
  description: string;
  attributes: string[];
  created_at: Date;
  updated_at: Date;
};

function publicOwned(row: OwnedRow): OwnedProduct {
  return {
    id: row.id,
    shopifyProductId: row.shopify_product_id,
    domain: row.domain,
    subcategory: row.subcategory,
    title: row.title,
    merchant: row.merchant,
    imageUrl: row.image_url,
    imageAlt: row.image_alt,
    productUrl: row.product_url,
    description: row.description,
    attributes: Array.isArray(row.attributes) ? row.attributes : [],
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listOwnedProducts(userId: string) {
  const result = await databasePool.query<OwnedRow>(`SELECT * FROM user_owned_product WHERE user_id = $1 ORDER BY domain, subcategory, updated_at DESC`, [userId]);
  return result.rows.map(publicOwned);
}

export async function findOwnedProduct(userId: string, id: string) {
  const result = await databasePool.query<OwnedRow>(`SELECT * FROM user_owned_product WHERE user_id = $1 AND id = $2 LIMIT 1`, [userId, id]);
  return result.rows[0] ? publicOwned(result.rows[0]) : null;
}

export async function upsertOwnedProduct(userId: string, product: LiveShopifyProduct, domain: ProductDomain, subcategory: string, attributes: string[] = []) {
  const result = await databasePool.query<OwnedRow>(`
    INSERT INTO user_owned_product (
      id, user_id, shopify_product_id, domain, subcategory, title, merchant,
      image_url, image_alt, product_url, description, attributes, created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,NOW(),NOW())
    ON CONFLICT (user_id, shopify_product_id) DO UPDATE SET
      domain = EXCLUDED.domain, subcategory = EXCLUDED.subcategory, title = EXCLUDED.title,
      merchant = EXCLUDED.merchant, image_url = EXCLUDED.image_url, image_alt = EXCLUDED.image_alt,
      product_url = EXCLUDED.product_url, description = EXCLUDED.description,
      attributes = EXCLUDED.attributes, updated_at = NOW()
    RETURNING *
  `, [crypto.randomUUID(), userId, product.id, domain, subcategory, product.title.slice(0, 300), product.merchant.slice(0, 180), product.imageUrl, product.imageAlt.slice(0, 300), product.productUrl, product.description.slice(0, 1200), JSON.stringify(attributes.slice(0, 30))]);
  return publicOwned(result.rows[0]);
}

export async function recordProductInteraction(userId: string, eventType: string, data: { ownedProductId?: string | null; shopifyProductId?: string | null; sourceKey?: string | null; requirementId?: string | null; metadata?: Record<string, unknown> } = {}) {
  await databasePool.query(`
    INSERT INTO user_product_interaction (id, user_id, owned_product_id, shopify_product_id, source_key, requirement_id, event_type, metadata, created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,NOW())
  `, [crypto.randomUUID(), userId, data.ownedProductId || null, data.shopifyProductId || null, data.sourceKey || null, data.requirementId || null, eventType.slice(0, 80), JSON.stringify(data.metadata || {})]);
}

export async function removeOwnedProduct(userId: string, ownedProductId: string, feedback: { rating?: number | null; neverTried?: boolean; feedbackTags?: string[] } = {}) {
  const client = await databasePool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query<OwnedRow>(`SELECT * FROM user_owned_product WHERE user_id = $1 AND id = $2 FOR UPDATE`, [userId, ownedProductId]);
    if (!found.rows[0]) {
      await client.query("ROLLBACK");
      return false;
    }
    const row = found.rows[0];
    await client.query(`
      INSERT INTO user_product_rating (id, user_id, shopify_product_id, product_title, rating, never_tried, feedback_tags, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,NOW())
    `, [crypto.randomUUID(), userId, row.shopify_product_id, row.title, feedback.rating ?? null, Boolean(feedback.neverTried), JSON.stringify((feedback.feedbackTags || []).slice(0, 20))]);
    await client.query(`
      INSERT INTO user_product_interaction (id, user_id, owned_product_id, shopify_product_id, event_type, metadata, created_at)
      VALUES ($1,$2,$3,$4,'owned_product_removed',$5::jsonb,NOW())
    `, [crypto.randomUUID(), userId, row.id, row.shopify_product_id, JSON.stringify(feedback)]);
    await client.query(`DELETE FROM user_owned_product WHERE user_id = $1 AND id = $2`, [userId, ownedProductId]);
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getCachedProductFit(userId: string, ownedProductId: string, requirementId: string, sourceKey: string) {
  const result = await databasePool.query<{ assessment: ProductFitAssessment; model: string }>(`
    SELECT assessment, model FROM user_product_fit_assessment
    WHERE user_id = $1 AND owned_product_id = $2 AND requirement_id = $3 AND source_key = $4 LIMIT 1
  `, [userId, ownedProductId, requirementId, sourceKey]);
  if (!result.rows[0]) return null;
  return { ...result.rows[0].assessment, model: result.rows[0].model, cached: true };
}

export async function saveProductFit(userId: string, assessment: ProductFitAssessment) {
  await databasePool.query(`
    INSERT INTO user_product_fit_assessment (id, user_id, owned_product_id, requirement_id, source_key, assessment, model, created_at, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,NOW(),NOW())
    ON CONFLICT (user_id, owned_product_id, requirement_id, source_key) DO UPDATE SET assessment = EXCLUDED.assessment, model = EXCLUDED.model, updated_at = NOW()
  `, [crypto.randomUUID(), userId, assessment.ownedProductId, assessment.requirementId, assessment.sourceKey, JSON.stringify({ ...assessment, cached: undefined }), assessment.model]);
}
