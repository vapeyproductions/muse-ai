"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import {
  productById,
  type MuseProduct,
  type ProductKind,
} from "@/lib/product-catalog";
import { skinPriorityTags } from "@/lib/skin-profile";
import type { SavedSkinProfile } from "@/lib/skin-profile-types";
import type { ShoppingItem, ShoppingStatus } from "@/lib/shopping-store";
import type { MuseCatalog, MuseLook, UserAnalysis } from "@/lib/muse-types";
import type { SelfieVariant } from "@/lib/workspace-types";
import type { LiveShopifyProduct } from "@/lib/shopify-catalog-types";
import { productImageSrc } from "@/lib/product-image";
import { EssentialProductChecklist, OwnedProductsCatalog } from "@/components/ProductSystem";
import type { OwnedProduct } from "@/lib/product-profile-types";
import type { DemoBoardSnapshot } from "@/lib/demo-board-types";

type AchieveTab = "skin" | "makeup" | "hair";
type JourneyMode = "achieve" | "shopping";
type ShoppingState = { items: ShoppingItem[]; affinityTags: Record<string, number>; visitedSourceKeys: string[] };

function lookById(catalog: MuseCatalog, id?: string) {
  if (!id) return null;
  for (const muse of catalog.muses) {
    const look = muse.looks.find((candidate) => candidate.id === id);
    if (look) return { museName: muse.name, look };
  }
  return null;
}

function readable(text: string) {
  return text.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function includesAny(tags: string[], values: string[]) {
  const joined = tags.join(" ").toLowerCase();
  return values.some((value) => joined.includes(value));
}

function generatedLookName(kind: "makeup" | "hair", descriptors: string[]) {
  const normalized = descriptors.map((tag) => tag.toLowerCase().trim()).filter(Boolean);
  const find = (terms: string[]) => normalized.find((tag) => terms.some((term) => tag.includes(term)));
  const chosen = kind === "makeup"
    ? [
        find(["cat eye", "wing", "liner", "smok", "shadow", "lash"]),
        find(["rosy", "blush", "bronze", "sculpt", "contour", "glow", "dewy"]),
        find(["lip", "nude", "gloss", "matte", "bold"]),
      ]
    : [
        find(["curl", "wave", "straight", "sleek", "coily", "texture"]),
        find(["layer", "bob", "pixie", "bang", "fringe", "long", "short"]),
        find(["volume", "blowout", "updo", "bun", "ponytail", "braid", "part"]),
      ];
  const features = [...new Set(chosen.filter((value): value is string => Boolean(value)))]
    .slice(0, 3)
    .map(readable);
  if (!features.length) {
    descriptors.slice(0, 3).forEach((descriptor) => features.push(readable(descriptor)));
  }
  const fallback = kind === "makeup" ? "Soft Definition" : "Polished Texture";
  return `${features.join(" + ") || fallback} ${kind === "makeup" ? "Edit" : "Style"}`;
}

function makeupTechniques(look: MuseLook) {
  const tags = look.descriptors.map((tag) => tag.toLowerCase());
  const steps = [
    "Prep with light hydration and let it settle for two minutes so cream products grip without sliding.",
    "Apply complexion product from the center of the face outward, keeping coverage sheer wherever natural skin should remain visible.",
  ];
  if (includesAny(tags, ["smok", "shadow", "glam", "metallic", "shimmer"])) steps.push("Build the eye in thin layers: diffuse the transition first, deepen near the lashes, then place reflective texture last.");
  if (includesAny(tags, ["liner", "wing", "graphic", "cat eye"])) steps.push("Map the liner with the eye open, keep the inner line fine, and angle the outer point toward the brow tail.");
  if (includesAny(tags, ["blush", "rosy", "flush", "romantic"])) steps.push("Tap blush on gradually and diffuse the edge upward so the color reads as part of the skin.");
  if (includesAny(tags, ["bronze", "sculpt", "contour"])) steps.push("Place sculpting color under the cheekbone and along the temple, then blend upward to preserve lift.");
  if (includesAny(tags, ["lip", "gloss", "matte", "bold", "nude"])) steps.push("Sketch the lip shape from the corners inward, blur the edge if the reference is soft, then build color at the center.");
  steps.push("Balance the brows against the eye look with short, hair-like strokes; keep the inner brow softer than the tail.");
  if (steps.length < 6) steps.push("Echo the reference with restrained eye definition, a softly placed cheek, and a lip finish in the same visual intensity.");
  steps.push("Check both sides with the face relaxed, soften any hard edges, then set only the areas that crease or become shiny.");
  return steps;
}

function hairTechniques(look: MuseLook) {
  const tags = look.descriptors.map((tag) => tag.toLowerCase());
  const steps = [
    "Begin on detangled hair with products compatible with your natural texture rather than forcing the finished shape in one step.",
    "Divide the hair into clean, workable sections and establish the part before adding heat or hold product.",
  ];
  if (includesAny(tags, ["curl", "wave", "wavy"])) steps.push("Work in sections, apply shape product on damp hair, and dry with low airflow so the pattern stays defined.");
  if (includesAny(tags, ["straight", "sleek", "smooth", "blowout"])) steps.push("Use heat protection, direct airflow down the hair shaft, and finish each section cool before brushing it into shape.");
  if (includesAny(tags, ["volume", "bounce", "blowout"])) steps.push("Concentrate lift at the root and set the hair while warm; release only after each section has cooled.");
  if (includesAny(tags, ["updo", "bun", "ponytail", "braid", "slick"])) steps.push("Create the hidden structure first, secure it with pins or elastics, then refine the visible surface and face-framing pieces.");
  if (includesAny(tags, ["bang", "fringe"])) steps.push("Test the fringe shape without cutting first; direct it forward while damp and split it only after it is nearly dry.");
  steps.push("Recreate the overall silhouette before refining individual pieces; compare crown height, width at the sides, and the shape around the face.");
  if (steps.length < 6) steps.push("Adjust polish, texture, and hold gradually so the style keeps movement without hiding your natural density.");
  steps.push("Finish with the lightest amount of hold needed, then loosen the face-framing pieces until the result feels balanced from the front and side.");
  return steps;
}

function ShopifyProductImage({ product }: { product: LiveShopifyProduct }) {
  return (
    <span className="shopifyProductImage">
      {product.imageUrl ? (
        <Image src={productImageSrc(product.imageUrl)} alt={product.imageAlt} fill sizes="64px" unoptimized />
      ) : (
        <i aria-hidden="true">M</i>
      )}
    </span>
  );
}

function TechniqueTutorial({
  title,
  steps,
  kind,
  footnote,
}: {
  title: string;
  steps: string[];
  kind: "skin" | "makeup" | "hair";
  footnote?: string;
}) {
  const atlasIndex = (step: string, index: number) => {
    const text = step.toLowerCase();
    if (kind === "skin") {
      if (/clean|wash/.test(text)) return 0;
      if (/moist|hydrat|barrier/.test(text)) return 1;
      if (/sun|spf|uv/.test(text)) return 2;
      if (/serum|treat|texture|redness|pore/.test(text)) return 3;
      return index % 4;
    }
    if (kind === "makeup") {
      if (/prep|hydrat/.test(text)) return 4;
      if (/complexion|foundation|coverage|skin/.test(text)) return 5;
      if (/shadow|metallic|shimmer/.test(text)) return 6;
      if (/liner|wing|cat eye/.test(text)) return 7;
      if (/blush|cheek|sculpt|contour|bronze/.test(text)) return 8;
      if (/lip/.test(text)) return 9;
      return 10;
    }
    if (/detang|section|part/.test(text)) return 11;
    if (/curl|wave|pattern/.test(text)) return 12;
    if (/smooth|straight|blow|heat|airflow/.test(text)) return 13;
    if (/updo|bun|ponytail|braid|fringe|silhouette|structure/.test(text)) return 14;
    return 15;
  };
  const tutorialImageForStep = (step: string, index: number) => {
    const text = step.toLowerCase();
    if (kind === "makeup") {
      if (text.includes("prep with light hydration")) return "/tutorials/steps/makeup-prep-hydration.webp";
      if (text.includes("apply complexion product from the center")) return "/tutorials/steps/makeup-sheer-complexion.webp";
      if (text.includes("build the eye in thin layers")) return "/tutorials/steps/makeup-layered-eyeshadow.webp";
      if (text.includes("map the liner with the eye open")) return "/tutorials/steps/makeup-map-eyeliner.webp";
      if (text.includes("balance the brows against the eye look")) return "/tutorials/steps/makeup-hair-stroke-brows.webp";
      if (text.includes("tap blush on gradually")) return "/tutorials/steps/makeup-lifted-blush.webp";
      if (text.includes("place sculpting color under the cheekbone")) return "/tutorials/steps/makeup-lifted-contour.webp";
      if (text.includes("sketch the lip shape from the corners inward")) return "/tutorials/steps/makeup-soft-lip.webp";
      if (text.includes("echo the reference with restrained eye definition")) return "/tutorials/steps/makeup-soft-balance.webp";
      if (text.includes("check both sides with the face relaxed")) return "/tutorials/steps/makeup-setting-powder.webp";
    }
    return `/tutorials/steps/generic-${atlasIndex(step, index)}.png`;
  };
  return (
    <section className={`techniqueTutorial techniqueTutorial-${kind}`}>
      <div className="achieveSectionHeading"><span>{title}</span><small>{steps.length} saved steps</small></div>
      <div className="techniqueStepRail">
        {steps.map((step, index) => (
          <article className="techniqueStepCard" key={`${index}-${step}`}>
            <div className="techniqueStepVisual">
              <Image
                src={tutorialImageForStep(step, index)}
                alt={`Generic model demonstrating step ${index + 1}: ${step}`}
                fill
                sizes="(max-width: 700px) 78vw, 260px"
                unoptimized
              />
              <span>{kind.toUpperCase()} / {String(index + 1).padStart(2, "0")}</span>
            </div>
            <strong>Step {index + 1}</strong>
            <p>{step}</p>
          </article>
        ))}
      </div>
      {footnote && <p className="techniqueFootnote">{footnote}</p>}
    </section>
  );
}

function ShopifySavedProducts({
  items,
  busy,
  onRemove,
  readOnly = false,
  demoAccount,
}: {
  items: ShoppingItem[];
  busy: string | null;
  onRemove: (item: ShoppingItem) => void;
  readOnly?: boolean;
  demoAccount?: string;
}) {
  const liveItems = items.filter((item) => item.productId.startsWith("gid://shopify/"));
  const [products, setProducts] = useState<LiveShopifyProduct[]>([]);
  const idsKey = [...new Set(liveItems.map((item) => item.productId))].sort().join("|");

  useEffect(() => {
    let cancelled = false;
    if (!idsKey) {
      return;
    }
    void fetch("/api/shopify-catalog", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: idsKey.split("|"), demoAccount }),
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Saved products could not be refreshed.");
        return payload.products as LiveShopifyProduct[];
      })
      .then((nextProducts) => { if (!cancelled) setProducts(nextProducts); })
      .catch(() => { if (!cancelled) setProducts([]); });
    return () => { cancelled = true; };
  }, [demoAccount, idsKey]);

  if (!liveItems.length) return null;
  return (
    <div className="shopifyProductList shopifySavedList">
      {liveItems.map((item) => {
        const product = products.find((candidate) => candidate.id === item.productId);
        if (!product) return null;
        return (
          <article className="shopifyProduct checked" key={item.id}>
            {readOnly ? <span className="shopifyCheck shopifyCheckStatic" aria-label="Saved in this sample board">✓</span> : <button className="shopifyCheck" disabled={busy === item.productId} onClick={() => onRemove(item)} type="button" aria-label={`Remove ${product.title} from checklist`}>✓</button>}
            <ShopifyProductImage product={product} />
            <div className="shopifyProductCopy"><span>{product.category} · {product.merchant}</span><strong>{product.title}</strong><p>{product.description}</p></div>
            <b>{product.price}</b>
            <a href={product.productUrl} target="_blank" rel="noreferrer">VIEW PRODUCT ↗</a>
          </article>
        );
      })}
    </div>
  );
}

function ShopifyProductPreview({ kind, tags, readOnly = false }: { kind: ProductKind; tags: string[]; readOnly?: boolean }) {
  const [products, setProducts] = useState<LiveShopifyProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const tagKey = tags.join(",");

  useEffect(() => {
    if (readOnly) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const parameters = new URLSearchParams({ kind, tags: tagKey });
    void fetch(`/api/shopify-catalog?${parameters}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Product preview could not be loaded.");
        return payload.products as LiveShopifyProduct[];
      })
      .then((nextProducts) => { if (!cancelled) setProducts(nextProducts.slice(0, 4)); })
      .catch(() => { if (!cancelled) setProducts([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [kind, readOnly, tagKey]);

  return (
    <div className="shoppingPreview">
      <div className="shoppingPreviewIntro"><strong>Recommendation preview</strong><span>This look has not entered Achieve mode yet. These live suggestions are previews—not saved products.</span></div>
      {loading && <div className="shopifyProductStatus">Preparing product previews…</div>}
      {!loading && !products.length && <p className="achieveEmptyCopy">{readOnly ? "No products were saved for this sample look." : "Product previews are temporarily unavailable."}</p>}
      <div className="shoppingPreviewGrid">
        {products.map((product) => (
          <a href={product.productUrl} target="_blank" rel="noreferrer" className="shoppingPreviewProduct" key={product.id}>
            <span className="shoppingPreviewImage">
              {product.imageUrl ? <Image src={productImageSrc(product.imageUrl)} alt={product.imageAlt} fill sizes="120px" unoptimized /> : <i aria-hidden="true">M</i>}
            </span>
            <small>{product.category}</small>
            <strong>{product.title}</strong>
            <b>{product.price}</b>
          </a>
        ))}
      </div>
    </div>
  );
}

function ProductCard({
  product,
  item,
  busy,
  onChange,
  onRemove,
  readOnly = false,
}: {
  product: MuseProduct;
  item?: ShoppingItem;
  busy: string | null;
  onChange: (status: ShoppingStatus) => void;
  onRemove: () => void;
  readOnly?: boolean;
}) {
  return (
    <article className="achieveProductCard">
      <i className="productSwatch" style={{ background: product.tone }} aria-hidden="true" />
      <div className="productCardCopy">
        <span>{product.brand} / {product.category}</span>
        <strong>{product.name}</strong>
        <p>{product.why}</p>
      </div>
      <b>${product.price}</b>
      {!readOnly && <div className="productCardActions">
        <button className={item?.status === "saved" ? "active" : ""} disabled={busy === product.id} onClick={() => onChange("saved")}>Save</button>
        <button className={item?.status === "cart" ? "active" : ""} disabled={busy === product.id} onClick={() => onChange("cart")}>Add to bag</button>
        {item && <button className="productRemove" disabled={busy === product.id} onClick={onRemove} aria-label={`Remove ${product.name}`}>×</button>}
      </div>}
    </article>
  );
}

export default function AchieveWorkspace({
  journey,
  catalog,
  variants,
  currentVariant,
  onSelectVariant,
  onReturn,
  demoBoard,
  readOnly = false,
  onDemoBlocked,
}: {
  journey: JourneyMode;
  catalog: MuseCatalog;
  analysis: UserAnalysis;
  variants: SelfieVariant[];
  currentVariant: SelfieVariant;
  onSelectVariant: (id: string) => void;
  onReturn: () => void;
  demoBoard?: DemoBoardSnapshot;
  readOnly?: boolean;
  onDemoBlocked: () => void;
}) {
  const [tab, setTab] = useState<AchieveTab | null>(null);
  const [skinProfile, setSkinProfile] = useState<SavedSkinProfile | null>(demoBoard?.skinProfile || null);
  const [skinLoading, setSkinLoading] = useState(false);
  const [skinError, setSkinError] = useState("");
  const [shopping, setShopping] = useState<ShoppingState>(demoBoard?.shopping || { items: [], affinityTags: {}, visitedSourceKeys: [] });
  const [ownedProducts, setOwnedProducts] = useState<OwnedProduct[]>(demoBoard?.ownedProducts || []);
  const [shoppingError, setShoppingError] = useState("");
  const [busyProduct, setBusyProduct] = useState<string | null>(null);
  const generatedLooks = variants.filter((variant) => variant.sourceKind === "generated");
  const makeupSource = useMemo(() => lookById(catalog, currentVariant.makeup?.lookId), [catalog, currentVariant.makeup?.lookId]);
  const hairSource = useMemo(() => lookById(catalog, currentVariant.hair?.lookId), [catalog, currentVariant.hair?.lookId]);
  const achieveSourceKey = currentVariant.storedSelfieId || currentVariant.id;
  const achieveSourceType: ProductKind = currentVariant.makeup ? "makeup" : currentVariant.hair ? "hair" : "skin";

  useEffect(() => {
    if (readOnly) return;
    let cancelled = false;
    void Promise.allSettled([
      fetch("/api/skin-profile", { cache: "no-store" }).then(async (response) => {
        const payload = await response.json();
        if (!response.ok && response.status !== 404) throw new Error(payload.error || "Your Skin Analysis could not be loaded.");
        return payload.profile as SavedSkinProfile | null;
      }),
      fetch("/api/shopping", { cache: "no-store" }).then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Your Product Catalog could not be loaded.");
        return payload as ShoppingState;
      }),
      fetch("/api/product-catalog", { cache: "no-store" }).then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Your owned products could not be loaded.");
        return payload.products as OwnedProduct[];
      }),
    ])
      .then(([profileResult, shoppingResult, ownedResult]) => {
        if (cancelled) return;
        if (profileResult.status === "fulfilled") setSkinProfile(profileResult.value);
        else setSkinError(profileResult.reason instanceof Error ? profileResult.reason.message : "Your Skin Analysis could not be loaded.");
        if (shoppingResult.status === "fulfilled") setShopping(shoppingResult.value);
        else setShoppingError(shoppingResult.reason instanceof Error ? shoppingResult.reason.message : "Your Product Catalog could not be loaded.");
        if (ownedResult.status === "fulfilled") setOwnedProducts(ownedResult.value);
        else setShoppingError(ownedResult.reason instanceof Error ? ownedResult.reason.message : "Your owned products could not be loaded.");
      });
    return () => { cancelled = true; };
  }, [readOnly]);

  useEffect(() => {
    if (readOnly || journey !== "achieve" || shopping.visitedSourceKeys.includes(achieveSourceKey)) return;
    let cancelled = false;
    void fetch("/api/shopping", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "viewed-achieve", sourceType: achieveSourceType, sourceKey: achieveSourceKey }),
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Muse could not remember this Achieve visit.");
        if (!cancelled) setShopping((current) => current.visitedSourceKeys.includes(achieveSourceKey) ? current : {
          ...current,
          visitedSourceKeys: [...current.visitedSourceKeys, achieveSourceKey],
        });
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [achieveSourceKey, achieveSourceType, journey, readOnly, shopping.visitedSourceKeys]);

  const context = useMemo(() => {
    if (tab === "skin") {
      return {
        kind: "skin" as const,
        sourceKey: skinProfile?.assessmentSelfieId || "current-assessment",
        tags: skinProfile ? skinPriorityTags(skinProfile) : ["daily", "gentle", "moisture"],
      };
    }
    const source = tab === "makeup" ? makeupSource : hairSource;
    return {
      kind: (tab || "makeup") as ProductKind,
      sourceKey: currentVariant.storedSelfieId || currentVariant.id,
      tags: source?.look.descriptors || [],
    };
  }, [currentVariant.id, currentVariant.storedSelfieId, hairSource, makeupSource, skinProfile, tab]);
  const runSkinAnalysis = async () => {
    if (readOnly) return onDemoBlocked();
    setSkinLoading(true);
    setSkinError("");
    try {
      const response = await fetch("/api/skin-profile", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Skin Analysis could not be completed.");
      setSkinProfile(payload.profile);
    } catch (error) {
      setSkinError(error instanceof Error ? error.message : "Skin Analysis could not be completed.");
    } finally {
      setSkinLoading(false);
    }
  };

  const changeProductById = async (productId: string, status: ShoppingStatus, sourceType = context.kind, sourceKey = context.sourceKey) => {
    if (readOnly) {
      onDemoBlocked();
      return false;
    }
    setBusyProduct(productId);
    setShoppingError("");
    try {
      const response = await fetch("/api/shopping", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productId, sourceType, sourceKey, status }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "That product could not be saved.");
      setShopping((current) => ({
        ...current,
        items: [payload.item, ...current.items.filter((item) => item.id !== payload.item.id)],
      }));
      return true;
    } catch (error) {
      setShoppingError(error instanceof Error ? error.message : "That product could not be saved.");
      return false;
    } finally {
      setBusyProduct(null);
    }
  };

  const changeProduct = (product: MuseProduct, status: ShoppingStatus, sourceType = context.kind, sourceKey = context.sourceKey) => (
    changeProductById(product.id, status, sourceType, sourceKey)
  );

  const removeProduct = async (item: ShoppingItem) => {
    if (readOnly) return onDemoBlocked();
    setBusyProduct(item.productId);
    try {
      const response = await fetch(`/api/shopping?id=${encodeURIComponent(item.id)}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "That product could not be removed.");
      setShopping((current) => ({ ...current, items: current.items.filter((candidate) => candidate.id !== item.id) }));
    } catch (error) {
      setShoppingError(error instanceof Error ? error.message : "That product could not be removed.");
    } finally {
      setBusyProduct(null);
    }
  };

  if (journey === "shopping") {
    const saved = shopping.items.filter((item) => item.status === "saved");
    const shoppingKind: ProductKind = currentVariant.makeup ? "makeup" : currentVariant.hair ? "hair" : "skin";
    const shoppingTags = shoppingKind === "makeup"
      ? makeupSource?.look.descriptors || ["natural"]
      : shoppingKind === "hair"
        ? hairSource?.look.descriptors || ["smooth"]
        : skinProfile ? skinPriorityTags(skinProfile) : ["daily", "gentle"];
    const currentLookKeys = new Set([currentVariant.id, currentVariant.storedSelfieId].filter((value): value is string => Boolean(value)));
    const currentLookItems = shopping.items.filter((item) => item.sourceType !== "skin" && currentLookKeys.has(item.sourceKey));
    const currentLookLegacyItems = currentLookItems.filter((item) => !item.productId.startsWith("gid://shopify/"));
    const savedLookProductLabel = currentVariant.makeup && currentVariant.hair
      ? "SAVED MAKEUP + HAIRCARE"
      : currentVariant.makeup
        ? "SAVED MAKEUP"
        : "SAVED HAIRCARE";
    const savedSkinItems = shopping.items.filter((item) => item.sourceType === "skin");
    const currentLookVisited = shopping.visitedSourceKeys.some((sourceKey) => currentLookKeys.has(sourceKey));
    const checkedCountFor = (variant: SelfieVariant) => {
      const keys = new Set([variant.id, variant.storedSelfieId].filter((value): value is string => Boolean(value)));
      return shopping.items.filter((item) => item.sourceType !== "skin" && keys.has(item.sourceKey)).length;
    };
    const curatedLookCount = generatedLooks.filter((variant) => checkedCountFor(variant) > 0).length;
    return (
      <section className="achievePanel shoppingPanel">
        <header className="achieveHeader">
          <div><span className="systemLabel">PRODUCT CATALOG / OWNED + SAVED</span><h1>Your product catalog</h1></div>
          <button onClick={onReturn}>Return to inspiration</button>
        </header>
        <div className="achieveScroll">
          {shoppingError && <div className="achieveError">{shoppingError}</div>}
          <section className="shoppingSummary">
            <article><small>SKIN PROFILE</small><strong>{skinProfile?.skinType || "Not assessed"}</strong><p>{skinProfile?.summary || "Run Skin Analysis from Achieve This Look to build your saved skincare summary."}</p></article>
            <article><small>SAVED PRODUCTS</small><strong>{saved.length}</strong><p>Ideas you want to revisit.</p></article>
            <article><small>CURATED LOOKS</small><strong>{curatedLookCount}</strong><p>Looks with saved product recommendations.</p></article>
          </section>
          <OwnedProductsCatalog products={ownedProducts} onChange={setOwnedProducts} readOnly={readOnly} onDemoBlocked={onDemoBlocked} />
          <section className="shoppingLooksSection">
            <div className="achieveSectionHeading"><span>YOUR GENERATED LOOKS</span><small>{generatedLooks.length} routines</small></div>
            <div className="shoppingLookRail">
              {generatedLooks.map((variant) => {
                const checkedCount = checkedCountFor(variant);
                return (
                  <button
                    className={variant.id === currentVariant.id ? "shoppingLook active" : "shoppingLook"}
                    onClick={() => onSelectVariant(variant.id)}
                    aria-label={`Show saved products for ${variant.label}`}
                    title={`Show saved products for ${variant.label}`}
                    key={variant.id}
                  >
                    <span><Image src={variant.imageUrl} alt="" fill sizes="72px" unoptimized /></span>
                    <strong>{variant.label}</strong><small>{checkedCount ? `${checkedCount} CHECKED` : "PREVIEW"}</small>
                  </button>
                );
              })}
            </div>
          </section>
          <section>
            <div className="achieveSectionHeading"><span>{currentVariant.label.toUpperCase()} / {savedLookProductLabel}</span><small>{currentLookItems.length} products</small></div>
            {currentLookItems.length ? <>
              <ShopifySavedProducts items={currentLookItems} busy={busyProduct} onRemove={(item) => void removeProduct(item)} readOnly={readOnly} demoAccount={demoBoard?.account} />
              {currentLookLegacyItems.length > 0 && <div className="achieveProductGrid legacyProductList">
                {currentLookLegacyItems.map((item) => {
                  const product = productById(item.productId);
                  return product ? <ProductCard key={item.id} product={product} item={item} busy={busyProduct} onChange={(status) => void changeProduct(product, status, item.sourceType, item.sourceKey)} onRemove={() => void removeProduct(item)} readOnly={readOnly} /> : null;
                })}
              </div>}
            </> : currentLookVisited
              ? <p className="achieveEmptyCopy shoppingLookEmpty">You opened this look in Achieve mode but did not save any recommendations. Return to Achieve to build its product plan.</p>
              : <ShopifyProductPreview key={`${shoppingKind}:${shoppingTags.join(",")}`} kind={shoppingKind} tags={shoppingTags} readOnly={readOnly} />}
          </section>
          {savedSkinItems.length > 0 && <section>
            <div className="achieveSectionHeading"><span>SAVED SKINCARE</span><small>{savedSkinItems.length} products</small></div>
            <ShopifySavedProducts items={savedSkinItems} busy={busyProduct} onRemove={(item) => void removeProduct(item)} readOnly={readOnly} demoAccount={demoBoard?.account} />
            {savedSkinItems.some((item) => !item.productId.startsWith("gid://shopify/")) && <div className="achieveProductGrid legacyProductList">
                {savedSkinItems.filter((item) => !item.productId.startsWith("gid://shopify/")).map((item) => {
                  const product = productById(item.productId);
                  return product ? <ProductCard key={item.id} product={product} item={item} busy={busyProduct} onChange={(status) => void changeProduct(product, status, item.sourceType, item.sourceKey)} onRemove={() => void removeProduct(item)} readOnly={readOnly} /> : null;
                })}
              </div>}
          </section>}
        </div>
      </section>
    );
  }

  return (
    <section className="achievePanel">
      <header className="achieveHeader">
        <div><span className="systemLabel">ACHIEVE THIS LOOK / {currentVariant.label.toUpperCase()}</span><h1>{tab ? `${readable(tab)} protocol` : "Craft this look"}</h1></div>
        <button onClick={onReturn}>Return to inspiration</button>
      </header>
      <div className="achieveScroll">
        {!tab && (
          <div className="achieveOpening">
            <span className="achieveOrb" aria-hidden="true"><i /></span>
            <h2>Click a tab below to begin crafting this look.</h2>
            <p>Build the skin, makeup, and hair routine behind the selected photo, then keep owned products and saved recommendations in one adaptive Product Catalog.</p>
          </div>
        )}
        {tab === "skin" && (
          <div className="achieveRoutine">
            {!skinProfile ? (
              <section className="skinLaunchCard">
                <span className="systemLabel">YOUCAM SKIN ANALYSIS / 7 CONCERNS</span>
                <h2>Read the skin beneath every look.</h2>
                <p>Muse privately prepares a close-up from your current assessment selfie. YouCam still makes the final quality decision and needs a front-facing, evenly lit, neutral photo.</p>
                <ul><li>Skin type and moisture</li><li>Oil balance and blemish clarity</li><li>Redness, texture, and pore visibility</li></ul>
                <button className="skinAnalysisButton" disabled={skinLoading} onClick={() => void runSkinAnalysis()}>{skinLoading ? "ANALYZING WITH YOUCAM…" : "RUN SKIN ANALYSIS"}<span>↗</span></button>
                {skinError && <div className="achieveError">{skinError}</div>}
              </section>
            ) : (
              <>
                <section className="skinResultHero">
                  <div><span className="systemLabel">SAVED SKIN PROFILE</span><h2>{skinProfile.skinType || "Your skin signals"}</h2><p>{skinProfile.summary}</p><small className="skinProfileSource">Original assessment selfie · saved across every look until recalibration</small></div>
                  <strong>{skinProfile.overallScore ?? "—"}<small>AVG SIGNAL</small></strong>
                </section>
                <div className="skinScoreGrid">
                  {skinProfile.concerns.map((concern) => <article key={concern.type}><span>{concern.label}</span><strong>{concern.value || (concern.uiScore ?? "—")}</strong>{concern.uiScore !== null && <i><b style={{ width: `${concern.uiScore}%` }} /></i>}</article>)}
                </div>
                <TechniqueTutorial
                  title="MUSE ROUTINE NOTES"
                  steps={skinProfile.advice}
                  kind="skin"
                  footnote="Skin Analysis is cosmetic guidance, not a diagnosis. See a qualified clinician for persistent or changing concerns."
                />
                <EssentialProductChecklist domain="skin" tags={context.tags} sourceKey={context.sourceKey} ownedProducts={ownedProducts} onOwnedProductsChange={setOwnedProducts} onSaveRecommendation={(productId) => changeProductById(productId, "saved", "skin", context.sourceKey)} readOnly={readOnly} onDemoBlocked={onDemoBlocked} />
              </>
            )}
          </div>
        )}
        {tab === "makeup" && (
          <div className="achieveRoutine">
            {makeupSource ? <>
              <section className="lookPlanHero"><div><span className="systemLabel">MUSE AI MAKEUP NAME / {makeupSource.museName.toUpperCase()}</span><h2>{generatedLookName("makeup", makeupSource.look.descriptors)}</h2><p>{makeupSource.look.descriptors.map(readable).join(" · ")}</p></div><i>M</i></section>
              <TechniqueTutorial title="DETAILED MAKEUP TECHNIQUE" steps={makeupTechniques(makeupSource.look)} kind="makeup" />
              <EssentialProductChecklist domain="makeup" tags={makeupSource.look.descriptors} sourceKey={context.sourceKey} ownedProducts={ownedProducts} onOwnedProductsChange={setOwnedProducts} onSaveRecommendation={(productId) => changeProductById(productId, "saved", "makeup", context.sourceKey)} readOnly={readOnly} onDemoBlocked={onDemoBlocked} />
            </> : <div className="achieveUnavailable"><strong>No makeup layer in {currentVariant.label}.</strong><p>Select a generated photo with makeup, or add makeup from the inspiration board first.</p></div>}
          </div>
        )}
        {tab === "hair" && (
          <div className="achieveRoutine">
            {hairSource ? <>
              <section className="lookPlanHero"><div><span className="systemLabel">MUSE AI HAIR NAME / {hairSource.museName.toUpperCase()}</span><h2>{generatedLookName("hair", hairSource.look.descriptors)}</h2><p>Your natural texture → {hairSource.look.descriptors.map(readable).join(" · ")}</p></div><i>H</i></section>
              <TechniqueTutorial title="DETAILED HAIR TECHNIQUE" steps={hairTechniques(hairSource.look)} kind="hair" />
              <EssentialProductChecklist domain="hair" tags={hairSource.look.descriptors} sourceKey={context.sourceKey} ownedProducts={ownedProducts} onOwnedProductsChange={setOwnedProducts} onSaveRecommendation={(productId) => changeProductById(productId, "saved", "hair", context.sourceKey)} readOnly={readOnly} onDemoBlocked={onDemoBlocked} />
            </> : <div className="achieveUnavailable"><strong>No hair layer in {currentVariant.label}.</strong><p>Select a generated photo with hair, or add hair from the inspiration board first.</p></div>}
          </div>
        )}
        {shoppingError && <div className="achieveError achieveFloatingError">{shoppingError}</div>}
      </div>
      <nav className="achieveDock" aria-label="Achieve this look sections">
        {(["skin", "makeup", "hair"] as AchieveTab[]).map((item, index) => <button className={tab === item ? "active" : ""} onClick={() => setTab(item)} key={item}><span>0{index}</span>{item}</button>)}
      </nav>
    </section>
  );
}
