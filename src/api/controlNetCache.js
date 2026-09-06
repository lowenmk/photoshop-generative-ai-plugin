const createControlNetCache = (fetchStatus, refreshStatus) => {
  const cache = {
    initialized: false,
    status: {available: false, version: null, models: [], modules: [], reason: null},
    fetchPromise: null,
    refreshPromise: null,
    requestVersion: 0,
  };

  const get = async () => {
    if (cache.initialized) return cache.status;
    if (cache.refreshPromise) return cache.refreshPromise;
    if (cache.fetchPromise) return cache.fetchPromise;
    const requestVersion = cache.requestVersion;
    const fetchPromise = (async () => {
      try {
        const status = await fetchStatus();
        if (requestVersion === cache.requestVersion) {
          cache.status = status;
          cache.initialized = true;
          return status;
        }
        return cache.status;
      } finally {
        if (requestVersion === cache.requestVersion && cache.fetchPromise === fetchPromise) {
          cache.fetchPromise = null;
        }
      }
    })();
    cache.fetchPromise = fetchPromise;
    return fetchPromise;
  };

  const refresh = async () => {
    if (cache.refreshPromise) return cache.refreshPromise;
    const requestVersion = ++cache.requestVersion;
    cache.fetchPromise = null;
    const refreshPromise = (async () => {
      try {
        const status = await refreshStatus();
        if (requestVersion === cache.requestVersion) {
          cache.status = status;
          cache.initialized = true;
        }
        return status;
      } finally {
        if (requestVersion === cache.requestVersion && cache.refreshPromise === refreshPromise) {
          cache.refreshPromise = null;
        }
      }
    })();
    cache.refreshPromise = refreshPromise;
    return refreshPromise;
  };

  return {cache, get, refresh};
};

module.exports = {createControlNetCache};
