export const getStorefrontBaseUrl = (): string => {
  // Use only public storefront URL to avoid mismatches with admin URL.
  const fromEnv = (import.meta as any)?.env?.NEXT_PUBLIC_STOREFRONT_URL
    || (typeof window !== "undefined" ? window.location.origin : "");
  return (fromEnv || "").replace(/\/$/, "");
}

export const getProductUrlFromHandle = (handle: string): string => {
  const base = getStorefrontBaseUrl();
  return `${base}/products/${handle}`;
}
