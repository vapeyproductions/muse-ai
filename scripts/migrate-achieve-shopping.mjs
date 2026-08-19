import pg from "pg";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.user_skin_profile (
      user_id TEXT PRIMARY KEY,
      assessment_selfie_id TEXT NOT NULL,
      profile JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS user_skin_profile_assessment_idx
      ON public.user_skin_profile (assessment_selfie_id)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.user_shopping_item (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      source_type TEXT NOT NULL CHECK (source_type IN ('skin', 'makeup', 'hair')),
      source_key TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('saved', 'cart')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (user_id, product_id, source_type, source_key)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS user_shopping_item_user_status_idx
      ON public.user_shopping_item (user_id, status, updated_at DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.user_recommendation_event (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      event_type TEXT NOT NULL CHECK (event_type IN ('viewed', 'saved', 'cart', 'removed')),
      source_type TEXT NOT NULL CHECK (source_type IN ('skin', 'makeup', 'hair')),
      source_key TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS user_recommendation_event_user_idx
      ON public.user_recommendation_event (user_id, created_at DESC)
  `);
  console.log("Achieve + shopping migration complete");
} finally {
  await pool.end();
}
