export const getStorefrontBaseUrl = (): string => {
  // Prefer explicit admin env var, then public env var, then window origin as last resort
  const fromEnv = (import.meta as any)?.env?.VITE_ADMIN_STOREFRONT_URL
    || (import.meta as any)?.env?.NEXT_PUBLIC_STOREFRONT_URL
    || (typeof window !== "undefined" ? window.location.origin : "");
  return (fromEnv || "").replace(/\/$/, "");
}

export const getProductUrlFromHandle = (handle: string): string => {
  const base = getStorefrontBaseUrl();
  return `${base}/products/${handle}`;
}
