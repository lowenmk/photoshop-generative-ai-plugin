const thumbnailCache = new Map();

const toDataUrl = async (response) => {
  const blob = await response.blob();
  if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
    return {src: URL.createObjectURL(blob), objectUrl: true};
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  if (typeof btoa !== "function") {
    throw new Error("Thumbnail caching is unavailable in this UXP runtime");
  }
  return {
    src: `data:${blob.type || "image/jpeg"};base64,${btoa(binary)}`,
    objectUrl: false,
  };
};

export const getThumbnailSrc = (url) => {
  const cached = thumbnailCache.get(url);
  if (cached?.src) {
    console.log(`[EasySD thumbnail cache] HIT ${url}`);
    return Promise.resolve(cached.src);
  }
  if (cached?.promise) {
    console.log(`[EasySD thumbnail cache] JOIN ${url}`);
    return cached.promise;
  }

  console.log(`[EasySD thumbnail cache] MISS ${url}`);
  const entry = cached || {};
  entry.promise = fetch(url)
    .then(response => {
      if (!response.ok) throw new Error(`Could not load thumbnail (${response.status})`);
      return toDataUrl(response);
    })
    .then(({src, objectUrl}) => {
      entry.src = src;
      entry.objectUrl = objectUrl;
      entry.promise = null;
      return src;
    })
    .catch(error => {
      thumbnailCache.delete(url);
      throw error;
    });
  thumbnailCache.set(url, entry);
  return entry.promise;
};

export const removeThumbnailSrc = (url) => {
  const entry = thumbnailCache.get(url);
  if (!entry) return;
  if (entry.objectUrl && entry.src && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
    URL.revokeObjectURL(entry.src);
  }
  thumbnailCache.delete(url);
};
