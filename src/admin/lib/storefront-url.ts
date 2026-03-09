export const getStorefrontBaseUrl = (): string => {
  const envBase = import.meta.env.VITE_STOREFRONT_URL &&
    (import.meta.env.VITE_STOREFRONT_URL as string).replace(/\/$/, "");

  if (envBase) {
    return envBase;
  }

  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  return "";
}

export const getProductUrlFromHandle = (handle: string): string => {
  const base = getStorefrontBaseUrl();
  return `${base}/products/${handle}`;
}
