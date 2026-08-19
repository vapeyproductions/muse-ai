export function productImageSrc(imageUrl: string) {
  return `/api/product-image?url=${encodeURIComponent(imageUrl)}`;
}
