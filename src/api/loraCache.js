export const createLoraCache = (fetchLoras, refreshLoras) => {
  const cache = {initialized: false, loras: [], fetchPromise: null, refreshPromise: null, requestVersion: 0};
  const get = async () => {
    if (cache.initialized) return cache.loras;
    if (cache.fetchPromise) return cache.fetchPromise;
    const requestVersion = cache.requestVersion;
    cache.fetchPromise = (async () => {
      try {
        const loras = await fetchLoras();
        if (requestVersion === cache.requestVersion) {
          cache.loras = loras;
          cache.initialized = true;
          return loras;
        }
        return cache.loras;
      } finally {
        if (requestVersion === cache.requestVersion) cache.fetchPromise = null;
      }
    })();
    return cache.fetchPromise;
  };
  const refresh = async () => {
    if (cache.refreshPromise) return cache.refreshPromise;
    const requestVersion = ++cache.requestVersion;
    const refreshPromise = (async () => {
      try {
        const loras = await refreshLoras();
        if (requestVersion === cache.requestVersion) {
          cache.loras = loras;
          cache.initialized = true;
        }
        return loras;
      } finally {
        if (requestVersion === cache.requestVersion) {
          cache.fetchPromise = null;
          cache.refreshPromise = null;
        }
      }
    })();
    cache.refreshPromise = refreshPromise;
    cache.fetchPromise = refreshPromise;
    return refreshPromise;
  };
  return {cache, get, refresh};
};
