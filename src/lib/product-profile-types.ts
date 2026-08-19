import type { LiveShopifyProduct } from "@/lib/shopify-catalog-types";

export type ProductDomain = "skin" | "makeup" | "hair";
export type ProductFitVerdict = "excellent" | "good" | "partial" | "poor";

export type ProductRequirement = {
  id: string;
  domain: ProductDomain;
  subcategory: string;
  label: string;
  description: string;
  desiredTraits: string[];
  avoidTraits: string[];
  searchQuery: string;
};

export type OwnedProduct = {
  id: string;
  shopifyProductId: string;
  domain: ProductDomain;
  subcategory: string;
  title: string;
  merchant: string;
  imageUrl: string | null;
  imageAlt: string;
  productUrl: string;
  description: string;
  attributes: string[];
  createdAt: string;
  updatedAt: string;
};

export type ProductFitAssessment = {
  requirementId: string;
  ownedProductId: string;
  sourceKey: string;
  score: number;
  verdict: ProductFitVerdict;
  explanation: string;
  model: string;
  cached: boolean;
};

export type OwnedProductInput = {
  product: LiveShopifyProduct;
  domain: ProductDomain;
  subcategory: string;
  sourceKey?: string;
  attributes?: string[];
};

export const PRODUCT_SUBCATEGORIES: Record<ProductDomain, Array<{ id: string; label: string }>> = {
  skin: [
    { id: "cleanser", label: "Cleanser" },
    { id: "moisturizer", label: "Moisturizer" },
    { id: "sunscreen", label: "Sunscreen" },
    { id: "serum", label: "Serum" },
    { id: "toner", label: "Toner" },
    { id: "treatment", label: "Treatment" },
    { id: "other-skincare", label: "Other skincare" },
  ],
  makeup: [
    { id: "foundation", label: "Foundation" },
    { id: "concealer", label: "Concealer" },
    { id: "eyeshadow", label: "Eyeshadow" },
    { id: "eyeliner", label: "Eyeliner" },
    { id: "mascara", label: "Mascara" },
    { id: "brows", label: "Brows" },
    { id: "blush", label: "Blush" },
    { id: "bronzer-contour", label: "Bronzer + contour" },
    { id: "lip", label: "Lip" },
    { id: "other-makeup", label: "Other makeup" },
  ],
  hair: [
    { id: "shampoo", label: "Shampoo" },
    { id: "conditioner", label: "Conditioner" },
    { id: "heat-protection", label: "Heat protection" },
    { id: "leave-in", label: "Leave-in treatment" },
    { id: "styling", label: "Styling product" },
    { id: "spray", label: "Spray + hold" },
    { id: "tool", label: "Styling tool" },
    { id: "other-haircare", label: "Other haircare" },
  ],
};
