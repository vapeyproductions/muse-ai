export type LiveShopifyProduct = {
  id: string;
  category: string;
  title: string;
  description: string;
  merchant: string;
  price: string;
  imageUrl: string | null;
  imageAlt: string;
  productUrl: string;
  checkoutUrl: string | null;
};
