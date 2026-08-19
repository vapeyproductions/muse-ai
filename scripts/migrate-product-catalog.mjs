import pg from "pg";

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!connectionString) throw new Error("DATABASE_URL or POSTGRES_URL is required.");
const pool = new pg.Pool({ connectionString, ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false } });

await pool.query(`
  CREATE TABLE IF NOT EXISTS user_owned_product (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    shopify_product_id text NOT NULL,
    domain text NOT NULL CHECK (domain IN ('skin','makeup','hair')),
    subcategory text NOT NULL,
    title text NOT NULL,
    merchant text NOT NULL,
    image_url text,
    image_alt text NOT NULL DEFAULT '',
    product_url text NOT NULL,
    description text NOT NULL DEFAULT '',
    attributes jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, shopify_product_id)
  );
  CREATE INDEX IF NOT EXISTS user_owned_product_user_category_idx ON user_owned_product(user_id, domain, subcategory);

  CREATE TABLE IF NOT EXISTS user_product_interaction (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    owned_product_id text,
    shopify_product_id text,
    source_key text,
    requirement_id text,
    event_type text NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS user_product_interaction_user_time_idx ON user_product_interaction(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS user_product_interaction_training_idx ON user_product_interaction(event_type, requirement_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS user_product_rating (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    shopify_product_id text NOT NULL,
    product_title text NOT NULL,
    rating integer CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
    never_tried boolean NOT NULL DEFAULT false,
    feedback_tags jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS user_product_rating_user_idx ON user_product_rating(user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS user_product_fit_assessment (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    owned_product_id text NOT NULL,
    requirement_id text NOT NULL,
    source_key text NOT NULL,
    assessment jsonb NOT NULL,
    model text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, owned_product_id, requirement_id, source_key)
  );
  CREATE INDEX IF NOT EXISTS user_product_fit_user_idx ON user_product_fit_assessment(user_id, updated_at DESC);
`);

console.log("Product Catalog tables are ready.");
await pool.end();
