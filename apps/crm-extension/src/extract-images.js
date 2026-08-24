/**
 * Page image extractor, injected on demand via chrome.scripting.
 *
 * Two functions are exported, both entirely self-contained (no imports, no
 * closure over the extension) because chrome.scripting stringifies and runs
 * them in the page context.
 *
 *   extractImages()      → { images: [{ url, width, height, alt }] }
 *   fetchImageDataUrls(urls) → { results: [{ url, dataUrl, mimeType, ok }] }
 *
 * extractImages scans the DOM for <img>, <picture> <source>, <a href="image/*">
 * and CSS background-image URLs, dedupes, and returns only reasonably-sized
 * images (skips icons, sprites, tracking pixels, SVGs under 32px).
 *
 * fetchImageDataUrls fetches each URL from the page context (so same-origin
 * and CORS-enabled CDNs like i.pinimg.com work directly) and returns a base64
 * data URL. For non-CORS cross-origin images it falls back to a canvas draw
 * with crossOrigin="anonymous".
 */

export function extractImages() {
  const seen = new Set();
  const images = [];

  const push = (url, width, height, alt) => {
    if (!url || seen.has(url)) return;
    // Skip data URLs that are tiny icons, and non-image protocols.
    if (url.startsWith("data:image/svg")) return;
    if (!/^https?:\/\//.test(url) && !url.startsWith("data:image/")) return;
    // Skip obvious icons / tracking pixels by size hint.
    if (width && height && width < 32 && height < 32) return;
    seen.add(url);
    images.push({ url, width: width || 0, height: height || 0, alt: alt || "" });
  };

  // <img> elements — the primary source.
  for (const img of document.querySelectorAll("img")) {
    const src = img.currentSrc || img.src;
    if (!src) continue;
    push(src, img.naturalWidth || img.width, img.naturalHeight || img.height, img.alt);
  }

  // <picture> <source> — srcset candidates.
  for (const source of document.querySelectorAll("picture source")) {
    const srcset = source.getAttribute("srcset") || "";
    const first = srcset.split(",")[0]?.trim().split(/\s+/)[0];
    if (first) push(first, 0, 0, "");
  }

  // <a href="...image"> — linked full-size images.
  for (const a of document.querySelectorAll('a[href]')) {
    const href = a.getAttribute("href") || "";
    if (/\.(jpe?g|png|webp|gif)(\?|$)/i.test(href)) {
      try {
        push(new URL(href, location.href).href, 0, 0, a.textContent?.trim() || "");
      } catch {}
    }
  }

  // CSS background-image — some galleries use divs with bg images.
  for (const el of document.querySelectorAll('[style*="background-image"]')) {
    const style = el.getAttribute("style") || "";
    const m = style.match(/url\(["']?(https?:\/\/[^"')]+)["']?\)/i);
    if (m) push(m[1], el.clientWidth, el.clientHeight, "");
  }

  // Cap the list so a very image-heavy page doesn't freeze the popup.
  return { images: images.slice(0, 60) };
}

export async function fetchImageDataUrls(urls) {
  const results = [];

  // Get natural dimensions from a data URL by loading it into an Image.
  const dimensions = (dataUrl) =>
    new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
      img.onerror = () => resolve({ width: 0, height: 0 });
      img.src = dataUrl;
    });

  const viaFetch = async (url) => {
    const res = await fetch(url, { mode: "cors" });
    const blob = await res.blob();
    if (!blob.type.startsWith("image/")) throw new Error(`Not an image: ${blob.type}`);
    const dataUrl = await blobToDataUrl(blob);
    const dims = await dimensions(dataUrl);
    return { dataUrl, mimeType: blob.type, width: dims.width, height: dims.height };
  };

  const viaCanvas = (url) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          const w = img.naturalWidth || img.width;
          const h = img.naturalHeight || img.height;
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0);
          const dataUrl = canvas.toDataURL("image/png");
          resolve({ dataUrl, mimeType: "image/png", width: w, height: h });
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = () => reject(new Error("Could not load image"));
      img.src = url;
    });

  const blobToDataUrl = (blob) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("FileReader failed"));
      reader.readAsDataURL(blob);
    });

  for (const url of urls) {
    try {
      let out;
      try {
        out = await viaFetch(url);
      } catch {
        out = await viaCanvas(url);
      }
      results.push({ url, dataUrl: out.dataUrl, mimeType: out.mimeType, width: out.width, height: out.height, ok: true });
    } catch (e) {
      results.push({ url, dataUrl: null, mimeType: null, ok: false, error: e.message });
    }
  }

  return { results };
}
