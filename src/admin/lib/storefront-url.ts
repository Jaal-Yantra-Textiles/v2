export const getStorefrontBaseUrl = (): string => {
// @ts-ignore
  const envBase = import.meta.env.VITE_STOREFRONT_URL &&
// @ts-ignore
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
