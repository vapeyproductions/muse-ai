"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { compatibleOwnedProduct, productRequirements } from "@/lib/product-requirements";
import {
  PRODUCT_SUBCATEGORIES,
  type OwnedProduct,
  type ProductDomain,
  type ProductFitAssessment,
  type ProductRequirement,
} from "@/lib/product-profile-types";
import type { LiveShopifyProduct } from "@/lib/shopify-catalog-types";
import { productImageSrc } from "@/lib/product-image";

function ProductImage({ product, size = "84px" }: { product: Pick<LiveShopifyProduct, "imageUrl" | "imageAlt" | "title">; size?: string }) {
  return <span className="productSystemImage">
    {product.imageUrl ? <Image src={productImageSrc(product.imageUrl)} alt={product.imageAlt || product.title} fill sizes={size} unoptimized /> : <i aria-hidden="true">M</i>}
  </span>;
}

async function recordInteraction(eventType: string, payload: Record<string, unknown>) {
  try {
    await fetch("/api/product-catalog", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "interaction", eventType, ...payload }),
    });
  } catch {
    // Interaction logging must never interrupt the user's product flow.
  }
}

function ShopifySearch({
  domain,
  subcategory,
  initialQuery = "",
  onSelect,
  onCancel,
}: {
  domain: ProductDomain;
  subcategory: string;
  initialQuery?: string;
  onSelect: (product: LiveShopifyProduct) => Promise<void> | void;
  onCancel?: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [products, setProducts] = useState<LiveShopifyProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selecting, setSelecting] = useState("");

  useEffect(() => {
    const clean = query.trim();
    if (clean.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      const parameters = new URLSearchParams({ kind: domain, q: clean, category: subcategory });
      void fetch(`/api/shopify-catalog?${parameters}`, { cache: "no-store", signal: controller.signal })
        .then(async (response) => {
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error || "Products could not be searched.");
          return payload.products as LiveShopifyProduct[];
        })
        .then(setProducts)
        .catch((reason) => { if (reason?.name !== "AbortError") setError(reason instanceof Error ? reason.message : "Products could not be searched."); })
        .finally(() => setLoading(false));
    }, 400);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [domain, query, subcategory]);

  return <div className="productSearchPanel">
    <div className="productSearchBar">
      <input autoFocus value={query} onChange={(event) => {
        const nextQuery = event.target.value;
        setQuery(nextQuery);
        if (nextQuery.trim().length < 2) { setProducts([]); setError(""); setLoading(false); }
      }} placeholder="Type a brand, product name, or product type" aria-label="Search Shopify products" />
      {onCancel && <button type="button" onClick={onCancel}>Close</button>}
    </div>
    {loading && <p className="productSearchStatus">Searching Shopify’s catalog…</p>}
    {error && <p className="productSearchError">{error}</p>}
    {!loading && query.trim().length >= 2 && !error && !products.length && <p className="productSearchStatus">No close products found. Try the brand plus the product name.</p>}
    <div className="productSearchResults">
      {products.map((product) => <button
        type="button"
        key={product.id}
        disabled={selecting === product.id}
        onClick={() => {
          setSelecting(product.id);
          Promise.resolve(onSelect(product)).finally(() => setSelecting(""));
        }}
      >
        <ProductImage product={product} size="58px" />
        <span><small>{product.merchant}</small><strong>{product.title}</strong><em>{product.price}</em></span>
      </button>)}
    </div>
  </div>;
}

function OwnedProductFit({ product, requirement, sourceKey, onRecommend, readOnly = false }: { product: OwnedProduct; requirement: ProductRequirement; sourceKey: string; onRecommend: () => void; readOnly?: boolean }) {
  const [assessment, setAssessment] = useState<ProductFitAssessment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (readOnly) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void fetch("/api/product-fit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownedProductId: product.id, requirement, sourceKey }),
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "This product could not be assessed.");
        return payload.assessment as ProductFitAssessment;
      })
      .then((next) => { if (!cancelled) setAssessment(next); })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "This product could not be assessed."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [product.id, readOnly, requirement, sourceKey]);

  return <div className="ownedFit">
    <ProductImage product={product} />
    <div className="ownedFitCopy">
      <small>FROM YOUR OWNED PRODUCTS</small>
      <div className="ownedFitTitleRow">
        <strong>{product.title}</strong>
        {assessment && <span className={`fitBadge fit-${assessment.verdict}`}>{assessment.verdict} fit · {assessment.score}%</span>}
      </div>
      {readOnly && <p>Saved in this sample account’s owned products.</p>}
      {loading && <p>Assessing this product against the look…</p>}
      {error && <p>{error}</p>}
      {assessment && <>
        <p>{assessment.explanation}</p>
        <button type="button" onClick={onRecommend}>Recommend products</button>
      </>}
    </div>
  </div>;
}

function RequirementCard({
  requirement,
  sourceKey,
  ownedProducts,
  onOwnedAdded,
  onSaveRecommendation,
  readOnly = false,
  onDemoBlocked,
}: {
  requirement: ProductRequirement;
  sourceKey: string;
  ownedProducts: OwnedProduct[];
  onOwnedAdded: (product: OwnedProduct) => void;
  onSaveRecommendation: (productId: string) => Promise<boolean>;
  readOnly?: boolean;
  onDemoBlocked: () => void;
}) {
  const owned = compatibleOwnedProduct(ownedProducts, requirement);
  const [searching, setSearching] = useState(false);
  const [recommend, setRecommend] = useState(false);
  const [recommendations, setRecommendations] = useState<LiveShopifyProduct[]>([]);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const showRecommendations = () => {
    setLoading(true);
    setError("");
    setRecommend(true);
    void recordInteraction("recommendations_requested", { sourceKey, requirementId: requirement.id, metadata: { domain: requirement.domain, subcategory: requirement.subcategory } });
  };

  useEffect(() => {
    if (!recommend) return;
    let cancelled = false;
    const parameters = new URLSearchParams({ kind: requirement.domain, q: requirement.searchQuery, category: requirement.label });
    void fetch(`/api/shopify-catalog?${parameters}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Recommendations could not be loaded.");
        return payload.products as LiveShopifyProduct[];
      })
      .then((products) => { if (!cancelled) setRecommendations(products); })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Recommendations could not be loaded."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [recommend, requirement]);

  const addOwned = async (product: LiveShopifyProduct, origin: string) => {
    const response = await fetch("/api/product-catalog", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ product, domain: requirement.domain, subcategory: requirement.subcategory, sourceKey, requirementId: requirement.id, origin, attributes: requirement.desiredTraits }),
    });
    const payload = await response.json();
    if (!response.ok) { setError(payload.error || "The product could not be added."); return; }
    onOwnedAdded(payload.product as OwnedProduct);
    setSearching(false);
    setRecommend(false);
  };

  return <article className="requirementCard">
    <header><span>{requirement.subcategory.replace(/-/g, " ")}</span><strong>{requirement.label}</strong><p>{requirement.description}</p></header>
    {owned
      ? <OwnedProductFit key={`${owned.id}:${sourceKey}`} product={owned} requirement={requirement} sourceKey={sourceKey} onRecommend={readOnly ? onDemoBlocked : showRecommendations} readOnly={readOnly} />
      : <div className="requirementEmpty"><p>No product in Your Owned Products currently fills this slot.</p><div><button type="button" onClick={readOnly ? onDemoBlocked : () => setSearching(true)}>Assess my current product</button><button type="button" onClick={readOnly ? onDemoBlocked : showRecommendations}>I don’t own this · Recommend products</button></div></div>}
    {owned && <button className="assessAnotherProduct" type="button" onClick={readOnly ? onDemoBlocked : () => setSearching(true)}>Assess a different product</button>}
    {searching && <ShopifySearch domain={requirement.domain} subcategory={requirement.subcategory} onCancel={() => setSearching(false)} onSelect={(product) => addOwned(product, "assess-current-product")} />}
    {recommend && <div className="recommendationReveal">
      <div className="recommendationRevealTitle"><strong>Recommended products</strong><span>Shown because you requested options for this requirement.</span></div>
      {loading && <p className="productSearchStatus">Finding close matches…</p>}
      {error && <p className="productSearchError">{error}</p>}
      <div className="recommendationProductGrid">
        {recommendations.filter((product) => !excluded.includes(product.id)).slice(0, 4).map((product) => <article key={product.id}>
          <ProductImage product={product} />
          <div><small>{product.merchant}</small><strong>{product.title}</strong><span>{product.price}</span></div>
          <a href={product.productUrl} target="_blank" rel="noreferrer">View product ↗</a>
          <div className="recommendationActions">
            <button type="button" onClick={() => void onSaveRecommendation(product.id).then((saved) => { if (saved) setExcluded((current) => [...current, product.id]); })}>Add to Product Catalog</button>
            <button type="button" onClick={() => void addOwned(product, "recommended-already-own")}>Already own</button>
            <button type="button" onClick={() => { setExcluded((current) => [...current, product.id]); void recordInteraction("recommendation_not_interested", { shopifyProductId: product.id, sourceKey, requirementId: requirement.id }); }}>Not interested</button>
          </div>
        </article>)}
      </div>
    </div>}
  </article>;
}

export function EssentialProductChecklist({
  domain,
  tags,
  sourceKey,
  ownedProducts,
  onOwnedProductsChange,
  onSaveRecommendation,
  readOnly = false,
  onDemoBlocked,
}: {
  domain: ProductDomain;
  tags: string[];
  sourceKey: string;
  ownedProducts: OwnedProduct[];
  onOwnedProductsChange: (products: OwnedProduct[]) => void;
  onSaveRecommendation: (productId: string) => Promise<boolean>;
  readOnly?: boolean;
  onDemoBlocked: () => void;
}) {
  const requirements = useMemo(() => productRequirements(domain, tags), [domain, tags]);
  const updateOwned = (product: OwnedProduct) => onOwnedProductsChange([product, ...ownedProducts.filter((candidate) => candidate.id !== product.id && candidate.shopifyProductId !== product.shopifyProductId)]);
  return <section className="essentialChecklist">
    <div className="achieveSectionHeading"><span>ESSENTIAL PRODUCT CHECKLIST</span><small>{requirements.length} requirements</small></div>
    <p className="essentialChecklistIntro">Muse checks the products you already own first. Live recommendations stay hidden until you ask for them or an owned product is not an ideal fit.</p>
    <div className="requirementList">
      {requirements.map((item) => <RequirementCard key={item.id} requirement={item} sourceKey={sourceKey} ownedProducts={ownedProducts} onOwnedAdded={updateOwned} onSaveRecommendation={onSaveRecommendation} readOnly={readOnly} onDemoBlocked={onDemoBlocked} />)}
    </div>
  </section>;
}

const FEEDBACK_TAGS = ["Effective", "Easy to use", "Good value", "Gentle", "Great finish", "Irritating", "Too heavy", "Too drying", "Poor match", "Hard to use"];

export function OwnedProductsCatalog({ products, onChange, readOnly = false, onDemoBlocked }: { products: OwnedProduct[]; onChange: (products: OwnedProduct[]) => void; readOnly?: boolean; onDemoBlocked: () => void }) {
  const [domain, setDomain] = useState<ProductDomain>("makeup");
  const [subcategory, setSubcategory] = useState(PRODUCT_SUBCATEGORIES.makeup[0].id);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<OwnedProduct | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<string[]>([]);
  const [error, setError] = useState("");
  const domainProducts = products.filter((product) => product.domain === domain);
  const grouped = PRODUCT_SUBCATEGORIES[domain].map((category) => ({ ...category, products: domainProducts.filter((product) => product.subcategory === category.id) })).filter((group) => group.products.length);

  const addProduct = async (product: LiveShopifyProduct) => {
    setError("");
    const response = await fetch("/api/product-catalog", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ product, domain, subcategory, origin: "manual-product-catalog" }) });
    const payload = await response.json();
    if (!response.ok) { setError(payload.error || "The product could not be added."); return; }
    const next = payload.product as OwnedProduct;
    onChange([next, ...products.filter((candidate) => candidate.id !== next.id && candidate.shopifyProductId !== next.shopifyProductId)]);
    setAdding(false);
  };

  const removeProduct = async (neverTried = false) => {
    if (!removing) return;
    const response = await fetch("/api/product-catalog", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ ownedProductId: removing.id, rating: neverTried ? null : rating, neverTried, feedbackTags: neverTried ? [] : feedback }) });
    const payload = await response.json();
    if (!response.ok) { setError(payload.error || "The product could not be removed."); return; }
    onChange(products.filter((product) => product.id !== removing.id));
    setRemoving(null); setRating(null); setFeedback([]);
  };

  return <section className="ownedCatalog">
    <div className="achieveSectionHeading"><span>YOUR OWNED PRODUCTS</span><small>{products.length} known products</small></div>
    <div className="ownedCatalogToolbar">
      <div>{(["skin", "makeup", "hair"] as ProductDomain[]).map((item) => <button className={domain === item ? "active" : ""} key={item} type="button" onClick={() => { setDomain(item); setSubcategory(PRODUCT_SUBCATEGORIES[item][0].id); }}>{item === "skin" ? "Skincare" : item === "hair" ? "Haircare" : "Makeup"}</button>)}</div>
      <button className="ownedAddButton" type="button" onClick={readOnly ? onDemoBlocked : () => setAdding((current) => !current)}>{adding ? "Close product search" : "+ Add a product"}</button>
    </div>
    {adding && <div className="ownedManualAdd"><label>Product category<select value={subcategory} onChange={(event) => setSubcategory(event.target.value)}>{PRODUCT_SUBCATEGORIES[domain].map((category) => <option value={category.id} key={category.id}>{category.label}</option>)}</select></label><ShopifySearch domain={domain} subcategory={subcategory} onSelect={addProduct} /></div>}
    {error && <p className="productSearchError">{error}</p>}
    {!grouped.length && !adding && <p className="ownedCatalogEmpty">No {domain === "skin" ? "skincare" : domain === "hair" ? "haircare" : "makeup"} products added yet.</p>}
    <div className="ownedGroups">{grouped.map((group) => <section key={group.id}><h3>{group.label}<span>{group.products.length}</span></h3><div className="ownedProductGrid">{group.products.map((product) => <article key={product.id}><ProductImage product={product} /><div><small>{product.merchant}</small><strong>{product.title}</strong><a href={product.productUrl} target="_blank" rel="noreferrer">View product ↗</a></div><button type="button" onClick={readOnly ? onDemoBlocked : () => setRemoving(product)} aria-label={`Remove ${product.title}`}>×</button></article>)}</div></section>)}</div>
    {removing && <div className="productRatingBackdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setRemoving(null); }}><div className="productRatingDialog" role="dialog" aria-modal="true" aria-label={`Remove ${removing.title}`}><span className="systemLabel">REMOVE FROM YOUR OWNED PRODUCTS</span><h2>{removing.title}</h2><p>If you tried it, your optional rating helps Muse learn which recommendations actually work for you.</p><div className="ratingStars" aria-label="Product rating">{[1,2,3,4,5].map((star) => <button className={rating && star <= rating ? "active" : ""} type="button" key={star} onClick={() => setRating(star)}>★</button>)}</div><div className="ratingTags">{FEEDBACK_TAGS.map((tag) => <button className={feedback.includes(tag) ? "active" : ""} type="button" key={tag} onClick={() => setFeedback((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag])}>{tag}</button>)}</div><div className="ratingActions"><button type="button" onClick={() => void removeProduct(true)}>I never tried this / I don’t know</button><button type="button" onClick={() => void removeProduct(false)}>Save feedback + remove</button><button type="button" onClick={() => setRemoving(null)}>Cancel</button></div></div></div>}
  </section>;
}
