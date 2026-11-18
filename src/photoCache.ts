// Keeps each slideshow photo on the tablet after the first download.
//
// Why: the photo links from Supabase change every few minutes (they're
// private, signed links), so the browser treated every rotation as a new
// photo and downloaded full-size phone pictures again and again. That used up
// Supabase's free egress. Now each photo is downloaded ONCE, shrunk, and kept
// in the browser's cache by its file name, no matter how often the link changes.

const CACHE_NAME = "mirror-photos-v1";
const MAX_SIDE = 1600; // plenty for the card; much smaller than a phone original

export interface CachedPhoto {
  src: string;   // object URL for <img>
  ratio: number; // width ÷ height
}

/** The part of a signed link that stays the same: the file path. */
export function photoId(url: string) {
  return url.split("?")[0];
}

function cacheKey(id: string) {
  return new Request(`${location.origin}/__mirror-photo/${encodeURIComponent(id)}`);
}

async function openCache(): Promise<Cache | null> {
  try {
    return "caches" in window ? await caches.open(CACHE_NAME) : null;
  } catch {
    return null;
  }
}

async function shrink(blob: Blob): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    if (scale === 1) return blob;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((ok) => canvas.toBlob((b) => ok(b ?? blob), "image/jpeg", 0.85));
  } catch {
    return blob;
  }
}

function measure(src: string): Promise<number> {
  return new Promise((ok) => {
    const img = new Image();
    img.onload = () => ok(img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1.5);
    img.onerror = () => ok(1.5);
    img.src = src;
  });
}

/** Get a photo from the tablet's cache, or download it once and keep it. */
export async function loadPhoto(url: string): Promise<CachedPhoto | null> {
  const id = photoId(url);
  const cache = await openCache();

  let blob: Blob | null = null;
  if (cache) {
    const hit = await cache.match(cacheKey(id));
    if (hit) blob = await hit.blob();
  }

  if (!blob) {
    try {
      const r = await fetch(url);
      if (!r.ok) return null;
      blob = await shrink(await r.blob());
      if (cache) {
        await cache.put(cacheKey(id), new Response(blob, { headers: { "Content-Type": blob.type || "image/jpeg" } }));
      }
    } catch {
      return null;
    }
  }

  const src = URL.createObjectURL(blob);
  return { src, ratio: await measure(src) };
}

/** Drop cached photos that were deleted from Supabase. */
export async function pruneCache(keepIds: string[]) {
  const cache = await openCache();
  if (!cache) return;
  const keep = new Set(keepIds.map((id) => cacheKey(id).url));
  for (const req of await cache.keys()) {
    if (!keep.has(req.url)) await cache.delete(req);
  }
}
