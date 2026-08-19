const SHOPIFY_IMAGE_HOSTS = new Set(["cdn.shopify.com"]);
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

export const runtime = "nodejs";

function placeholderResponse() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 360" role="img" aria-label="Product image unavailable">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#fffafd"/>
          <stop offset="1" stop-color="#f7dce9"/>
        </linearGradient>
      </defs>
      <rect width="360" height="360" rx="36" fill="url(#bg)"/>
      <rect x="131" y="105" width="98" height="145" rx="24" fill="#fff" stroke="#e799bd" stroke-width="8"/>
      <path d="M151 105V82h58v23" fill="none" stroke="#e799bd" stroke-width="8" stroke-linecap="round"/>
      <circle cx="180" cy="174" r="25" fill="#f3b5d1"/>
      <path d="M166 174h28M180 160v28" stroke="#fff" stroke-width="7" stroke-linecap="round"/>
    </svg>`;
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}

export async function GET(request: Request) {
  try {
    const source = new URL(request.url).searchParams.get("url");
    if (!source) return placeholderResponse();
    const target = new URL(source);
    if (target.protocol !== "https:" || !SHOPIFY_IMAGE_HOSTS.has(target.hostname)) return placeholderResponse();

    if (!target.searchParams.has("width")) target.searchParams.set("width", "360");
    const upstream = await fetch(target, {
      headers: { Accept: "image/avif,image/webp,image/jpeg,image/png,*/*" },
      next: { revalidate: 604_800 },
      redirect: "follow",
      signal: AbortSignal.timeout(7_000),
    });
    if (!upstream.ok) return placeholderResponse();
    const finalUrl = new URL(upstream.url);
    if (finalUrl.protocol !== "https:" || !SHOPIFY_IMAGE_HOSTS.has(finalUrl.hostname)) return placeholderResponse();
    const contentType = upstream.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) return placeholderResponse();
    const declaredSize = Number(upstream.headers.get("content-length") || 0);
    if (declaredSize > MAX_IMAGE_BYTES) return placeholderResponse();
    const image = await upstream.arrayBuffer();
    if (image.byteLength > MAX_IMAGE_BYTES) return placeholderResponse();

    return new Response(image, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(image.byteLength),
        "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return placeholderResponse();
  }
}
