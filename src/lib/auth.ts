import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins";
import { Pool } from "pg";

declare global {
  var museAuthPool: Pool | undefined;
}

const productionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : undefined;
const deploymentUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : undefined;
const runtimeBaseUrl =
  process.env.BETTER_AUTH_URL ??
  deploymentUrl ??
  productionUrl ??
  "http://localhost:3000";

const pool =
  globalThis.museAuthPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.museAuthPool = pool;
}

export const databasePool = pool;

export const auth = betterAuth({
  appName: "Muse",
  database: pool,
  baseURL: runtimeBaseUrl,
  secret: process.env.BETTER_AUTH_SECRET,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
  },
  plugins: [
    username({
      minUsernameLength: 3,
      maxUsernameLength: 24,
    }),
  ],
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  advanced: {
    cookiePrefix: "muse",
  },
  trustedOrigins: [
    "http://localhost:3000",
    "https://muse-black-phi.vercel.app",
    ...(deploymentUrl ? [deploymentUrl] : []),
    ...(productionUrl ? [productionUrl] : []),
  ],
});
