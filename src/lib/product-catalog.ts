export type ProductKind = "skin" | "makeup" | "hair";

export type MuseProduct = {
  id: string;
  kind: ProductKind;
  name: string;
  brand: string;
  category: string;
  price: number;
  tags: string[];
  why: string;
  tone: string;
};

export const MUSE_PRODUCTS: MuseProduct[] = [
  { id: "skin-cloud-cleanser", kind: "skin", name: "Cloud Reset Cleanser", brand: "Muse Lab", category: "Cleanser", price: 18, tags: ["acne", "oiliness", "redness", "gentle"], why: "A low-foam first step that cleans without leaving skin tight.", tone: "#f4dce8" },
  { id: "skin-barrier-serum", kind: "skin", name: "Barrier Signal Serum", brand: "Muse Lab", category: "Serum", price: 28, tags: ["moisture", "redness", "barrier", "gentle"], why: "Hydration and barrier support for stressed or dehydrated-looking skin.", tone: "#d8e7ff" },
  { id: "skin-water-gel", kind: "skin", name: "Water Matrix Gel", brand: "Muse Lab", category: "Moisturizer", price: 24, tags: ["moisture", "oiliness", "lightweight"], why: "Lightweight moisture that layers easily under makeup.", tone: "#cceeea" },
  { id: "skin-calm-cream", kind: "skin", name: "Calm Frequency Cream", brand: "Muse Lab", category: "Moisturizer", price: 30, tags: ["redness", "moisture", "barrier", "gentle"], why: "A richer fragrance-free finish for visible dryness or redness.", tone: "#f7ddd4" },
  { id: "skin-balance-serum", kind: "skin", name: "Balance 5% Serum", brand: "Muse Lab", category: "Treatment", price: 22, tags: ["oiliness", "pore", "texture", "acne"], why: "A simple balancing step for shine and the appearance of pores.", tone: "#e5dcff" },
  { id: "skin-polish-toner", kind: "skin", name: "Soft Focus Toner", brand: "Muse Lab", category: "Exfoliant", price: 20, tags: ["texture", "pore", "acne", "gradual"], why: "A gentle, gradual exfoliating option for uneven-looking texture.", tone: "#ffdce7" },
  { id: "skin-daily-shield", kind: "skin", name: "Daily Light Shield SPF 40", brand: "Muse Lab", category: "Sunscreen", price: 26, tags: ["daily", "redness", "texture", "all"], why: "Daily broad-spectrum protection is the anchor of every Muse routine.", tone: "#fff2c9" },
  { id: "makeup-grip-primer", kind: "makeup", name: "Glass Grip Primer", brand: "Muse Color", category: "Primer", price: 21, tags: ["dewy", "glowy", "glass skin", "luminous"], why: "Creates a smooth, luminous base for fresh-looking makeup.", tone: "#efdcff" },
  { id: "makeup-veil-tint", kind: "makeup", name: "Second Skin Veil", brand: "Muse Color", category: "Complexion", price: 32, tags: ["natural", "soft", "minimal", "dewy"], why: "Sheer, flexible coverage that keeps natural dimension visible.", tone: "#edc7b4" },
  { id: "makeup-sculpt-stick", kind: "makeup", name: "Soft Geometry Sculpt", brand: "Muse Color", category: "Contour", price: 24, tags: ["sculpted", "defined", "bronzed", "soft glam"], why: "A blendable cream for adding controlled shape and warmth.", tone: "#be8a75" },
  { id: "makeup-signal-blush", kind: "makeup", name: "Signal Flush Balm", brand: "Muse Color", category: "Blush", price: 19, tags: ["blush", "rosy", "fresh", "romantic", "soft"], why: "A translucent color balm for a diffused, skin-like flush.", tone: "#ed8eaa" },
  { id: "makeup-liner", kind: "makeup", name: "Precision Vector Liner", brand: "Muse Color", category: "Eyes", price: 17, tags: ["liner", "winged", "graphic", "defined", "smoky"], why: "A fine flexible tip for crisp wings or softly smudged definition.", tone: "#4b3645" },
  { id: "makeup-shadow", kind: "makeup", name: "Ambient Eye Quad", brand: "Muse Color", category: "Eyes", price: 29, tags: ["smoky", "shimmer", "neutral", "soft glam", "metallic"], why: "Four buildable textures for depth, haze, or reflective light.", tone: "#c7a6b8" },
  { id: "makeup-lash", kind: "makeup", name: "Lift Code Mascara", brand: "Muse Color", category: "Eyes", price: 20, tags: ["lashes", "defined", "natural", "dramatic"], why: "Separates and lifts lashes without overwhelming the eye shape.", tone: "#2f2530" },
  { id: "makeup-lip", kind: "makeup", name: "Blur Circuit Lip", brand: "Muse Color", category: "Lip", price: 18, tags: ["lip", "blurred", "matte", "glossy", "natural", "bold"], why: "Can be tapped on as a stain or layered for full-color impact.", tone: "#c85f79" },
  { id: "hair-heat-shield", kind: "hair", name: "Thermal Shield Mist", brand: "Muse Hair", category: "Prep", price: 23, tags: ["heat", "blowout", "straight", "waves", "volume"], why: "A lightweight prep layer before blow-drying or hot-tool styling.", tone: "#f3d5e4" },
  { id: "hair-smoothing", kind: "hair", name: "Fiber Gloss Serum", brand: "Muse Hair", category: "Finish", price: 25, tags: ["sleek", "straight", "smooth", "frizz", "shine"], why: "Adds slip and shine while helping flyaways look polished.", tone: "#e7dcf7" },
  { id: "hair-curl-cream", kind: "hair", name: "Shape Memory Cream", brand: "Muse Hair", category: "Styler", price: 24, tags: ["curl", "curly", "waves", "wavy", "definition", "frizz"], why: "Adds flexible definition without flattening natural texture.", tone: "#dce9ff" },
  { id: "hair-volume-mousse", kind: "hair", name: "Root Signal Mousse", brand: "Muse Hair", category: "Styler", price: 21, tags: ["volume", "blowout", "updo", "bounce"], why: "Builds airy root support for volume and longer-lasting shape.", tone: "#fee2cc" },
  { id: "hair-hold-gel", kind: "hair", name: "Contour Hold Gel", brand: "Muse Hair", category: "Styler", price: 19, tags: ["slick", "updo", "braid", "edges", "defined"], why: "Targeted flexible hold for precise parts, edges, and polished shapes.", tone: "#d7f1e9" },
  { id: "hair-texture-spray", kind: "hair", name: "Air Texture Spray", brand: "Muse Hair", category: "Finish", price: 22, tags: ["texture", "waves", "messy", "volume", "short"], why: "Adds airy separation so intentionally undone styles keep their shape.", tone: "#e8e4dc" },
  { id: "hair-pins", kind: "hair", name: "Invisible Architecture Pins", brand: "Muse Hair", category: "Tool", price: 12, tags: ["updo", "bun", "braid", "ponytail"], why: "Secure hidden structure for updos and sculptural shapes.", tone: "#dfc5cc" },
];

function normalizedTags(tags: string[]) {
  return tags.map((tag) => tag.toLowerCase().trim()).filter(Boolean);
}

export function recommendProducts(kind: ProductKind, tags: string[], affinities: Record<string, number> = {}, limit = 6) {
  const requested = new Set(normalizedTags(tags));
  return MUSE_PRODUCTS
    .filter((product) => product.kind === kind)
    .map((product, index) => ({
      product,
      score: product.tags.reduce((sum, tag) => sum + (requested.has(tag) ? 5 : 0) + (affinities[tag] || 0), 0) - index * .001,
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ product }) => product);
}

export function productById(id: string) {
  return MUSE_PRODUCTS.find((product) => product.id === id) || null;
}
