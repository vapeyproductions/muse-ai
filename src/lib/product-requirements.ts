import type {
  OwnedProduct,
  ProductDomain,
  ProductFitAssessment,
  ProductFitVerdict,
  ProductRequirement,
} from "@/lib/product-profile-types";

function textIncludes(tags: string[], words: string[]) {
  const text = tags.join(" ").toLowerCase();
  return words.some((word) => text.includes(word));
}

function requirement(
  domain: ProductDomain,
  subcategory: string,
  label: string,
  description: string,
  desiredTraits: string[],
  avoidTraits: string[],
  searchQuery: string,
): ProductRequirement {
  return {
    id: `${domain}-${subcategory}-${desiredTraits.slice(0, 2).join("-").replace(/[^a-z0-9-]/g, "-")}`,
    domain,
    subcategory,
    label,
    description,
    desiredTraits,
    avoidTraits,
    searchQuery,
  };
}

export function productRequirements(domain: ProductDomain, tags: string[]): ProductRequirement[] {
  if (domain === "skin") {
    const sensitive = textIncludes(tags, ["redness", "sensitive", "irritation"]);
    const dry = textIncludes(tags, ["dry", "moisture", "dehydrated"]);
    const pores = textIncludes(tags, ["pore", "texture", "oil"]);
    return [
      requirement("skin", "cleanser", sensitive ? "Gentle low-foam cleanser" : "Balanced daily cleanser", "Cleans without leaving skin tight or disrupting the barrier.", ["gentle", "non-stripping", sensitive ? "fragrance-free" : "daily"], ["harsh scrub", "high fragrance"], "gentle non stripping facial cleanser"),
      requirement("skin", "moisturizer", dry ? "Barrier-supporting moisturizer" : "Lightweight moisturizer", dry ? "Replenishes moisture and supports a comfortable skin barrier." : "Hydrates without feeling heavy under sunscreen or makeup.", [dry ? "barrier" : "lightweight", "hydrating", "non-comedogenic"], [dry ? "drying alcohol" : "heavy occlusive"], dry ? "barrier moisturizer ceramides" : "lightweight face moisturizer"),
      requirement("skin", "sunscreen", "Broad-spectrum facial sunscreen", "Daily UV protection with a wearable finish that layers well.", ["broad spectrum", "SPF 30", "face"], ["body-only", "tanning oil"], "broad spectrum face sunscreen SPF 30"),
      requirement("skin", pores ? "treatment" : "serum", pores ? "Texture-refining treatment" : sensitive ? "Calming serum" : "Targeted treatment serum", pores ? "A measured treatment that supports smoother-looking texture and pore visibility." : sensitive ? "A soothing formula for visible redness and sensitivity." : "Targets the strongest signal in your saved skin profile.", pores ? ["niacinamide", "texture", "lightweight"] : sensitive ? ["soothing", "barrier", "fragrance-free"] : ["targeted", "serum", "daily"], ["harsh scrub", "high fragrance"], pores ? "niacinamide texture serum" : sensitive ? "calming redness serum fragrance free" : "targeted face serum"),
    ];
  }

  if (domain === "makeup") {
    const natural = textIncludes(tags, ["natural", "soft", "dewy", "fresh", "sheer", "glow"]);
    const dramatic = textIncludes(tags, ["glam", "dramatic", "smok", "bold", "matte", "full"]);
    const liner = textIncludes(tags, ["liner", "wing", "cat eye", "graphic"]);
    const blush = textIncludes(tags, ["blush", "rosy", "flush", "cheek"]);
    return [
      requirement("makeup", "foundation", natural ? "Lightweight foundation" : dramatic ? "Medium-to-full coverage foundation" : "Buildable natural-finish foundation", natural ? "Keeps real skin visible while evening tone in thin layers." : dramatic ? "Creates an even, polished base that supports a higher-impact look." : "Builds only where needed without flattening the complexion.", natural ? ["lightweight", "sheer", "natural", "buildable"] : dramatic ? ["medium coverage", "full coverage", "longwear"] : ["buildable", "natural finish", "medium coverage"], natural ? ["full coverage", "heavy", "mask-like"] : ["sheer tint"], natural ? "lightweight sheer natural foundation" : dramatic ? "full coverage longwear foundation" : "buildable natural finish foundation"),
      requirement("makeup", "concealer", "Brightening concealer", "Adds controlled brightness beneath the eyes and around the center of the face.", ["brightening", "blendable", "medium coverage"], ["dry", "cakey"], "brightening blendable concealer"),
      liner
        ? requirement("makeup", "eyeliner", "Precise eyeliner", "Creates the defining line and outer shape without skipping or smudging.", ["precise", "longwear", "pigmented"], ["sheer", "smudges"], "precision longwear eyeliner")
        : requirement("makeup", "eyeshadow", dramatic ? "High-impact eyeshadow" : "Soft-build eyeshadow", dramatic ? "Builds the reference eye in controlled, saturated layers." : "Adds dimension with a blendable, softly diffused finish.", dramatic ? ["pigmented", "blendable", "matte"] : ["blendable", "soft", "buildable"], ["patchy", "chunky glitter"], dramatic ? "pigmented blendable eye shadow" : "soft blendable neutral eye shadow"),
      blush
        ? requirement("makeup", "blush", "Blendable cheek color", "Recreates the placement and intensity of the reference without a hard edge.", ["blendable", "buildable", "skin-like"], ["patchy", "stiff"], "blendable buildable blush")
        : requirement("makeup", "mascara", "Natural-definition mascara", "Separates and defines lashes without competing with the eye shape.", ["separating", "defined", "natural"], ["clumpy", "heavy fibers"], "natural separating mascara"),
    ];
  }

  const curl = textIncludes(tags, ["curl", "wave", "coily", "texture"]);
  const heat = textIncludes(tags, ["straight", "sleek", "smooth", "blowout", "curl", "wave"]);
  const hold = textIncludes(tags, ["updo", "bun", "ponytail", "braid", "hold", "slick"]);
  return [
    requirement("hair", "shampoo", "Gentle shampoo", "Cleans the scalp without leaving the lengths stripped before styling.", ["gentle", "scalp", "non-stripping"], ["harsh", "clarifying daily"], "gentle non stripping shampoo"),
    requirement("hair", "conditioner", curl ? "Slip-rich conditioner" : "Lightweight smoothing conditioner", curl ? "Provides slip and moisture so the pattern can form with less friction." : "Smooths the lengths without weighing down the finished shape.", curl ? ["slip", "moisture", "detangling"] : ["lightweight", "smoothing", "detangling"], [curl ? "drying" : "heavy butter"], curl ? "moisturizing detangling conditioner curls" : "lightweight smoothing conditioner"),
    heat
      ? requirement("hair", "heat-protection", "Heat protectant", "Protects the hair before blow-drying or hot-tool shaping.", ["heat protectant", "lightweight", "up to 400"], ["finishing spray only", "oil only"], "lightweight hair heat protectant")
      : requirement("hair", "leave-in", "Lightweight leave-in", "Adds manageable moisture and slip before shaping.", ["leave-in", "detangling", "lightweight"], ["heavy wax"], "lightweight leave in conditioner"),
    hold
      ? requirement("hair", "styling", "Flexible hold styling product", "Builds the structure while preserving movement and a touchable finish.", ["flexible hold", "brushable", "humidity"], ["crunchy", "rigid"], "flexible hold hair styling product")
      : requirement("hair", "styling", curl ? "Curl-defining styler" : "Shape-and-finish styler", curl ? "Encourages definition with controlled frizz and flexible movement." : "Supports the final silhouette and surface polish without stiffness.", curl ? ["curl definition", "anti-frizz", "flexible"] : ["lightweight", "smoothing", "flexible hold"], ["crunchy", "heavy wax"], curl ? "curl defining anti frizz styling cream" : "lightweight smoothing hair styling product"),
  ];
}

export function fallbackProductFit(
  owned: Pick<OwnedProduct, "id" | "title" | "description" | "attributes" | "subcategory">,
  productRequirement: ProductRequirement,
  sourceKey: string,
): ProductFitAssessment {
  const text = `${owned.title} ${owned.description} ${owned.attributes.join(" ")}`.toLowerCase();
  const desiredMatches = productRequirement.desiredTraits.filter((trait) => text.includes(trait.toLowerCase()));
  const conflicts = productRequirement.avoidTraits.filter((trait) => text.includes(trait.toLowerCase()));
  let score = owned.subcategory === productRequirement.subcategory ? 62 : 30;
  score += Math.min(24, desiredMatches.length * 8);
  score -= conflicts.length * 28;
  score = Math.max(5, Math.min(96, score));
  const verdict: ProductFitVerdict = score >= 84 ? "excellent" : score >= 68 ? "good" : score >= 48 ? "partial" : "poor";
  const explanation = conflicts.length
    ? `${owned.title} conflicts with the look’s ${productRequirement.label.toLowerCase()} requirement because its ${conflicts.join(" and ")} positioning may change the intended finish. You can still use it more sparingly, but a closer match will be easier.`
    : desiredMatches.length
      ? `${owned.title} supports this step through its ${desiredMatches.join(", ")} qualities. It should reproduce the intended result with normal technique adjustments.`
      : `${owned.title} is the right general product type, but its catalog details do not confirm the ${productRequirement.desiredTraits.slice(0, 2).join(" and ")} qualities this look needs. Treat it as a workable test rather than an exact match.`;
  return { requirementId: productRequirement.id, ownedProductId: owned.id, sourceKey, score, verdict, explanation, model: "deterministic-catalog-fit-v1", cached: false };
}

export function compatibleOwnedProduct(products: OwnedProduct[], productRequirement: ProductRequirement) {
  return products.find((product) => product.domain === productRequirement.domain && product.subcategory === productRequirement.subcategory) || null;
}
