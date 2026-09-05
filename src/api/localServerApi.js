const {NetworkError} = require("../exceptions/Exceptions");
const {ajaxClient} = require("./ajaxClient");

class LocalServerApi {

  resultsCache = {
    initialized: false,
    resultGroups: [],
    fetchPromise: null,
  }

  samplersCache = {
    initialized: false,
    samplers: [],
    fetchPromise: null,
  }

  modelsCache = {
    initialized: false,
    models: [],
    fetchPromise: null,
    refreshPromise: null,
    requestVersion: 0,
  }

  isLocalServerAndAutomatic1111Reachable = async () => {
    try {
      // Check that the server and Automatic1111 server are reachable
      const isAutomatic1111Reachable = await this.isAutomatic1111Reachable()
      return {
        isLocalServerReachable: true,
        isAutomatic1111Reachable,
      };
    } catch (e) {
      if (e instanceof NetworkError) {
        return {
          isLocalServerReachable: false,
        };
      }
      console.log("Unknown error trying to reach server. This shouldn't happen")
      return {
        isLocalServerReachable: false,
      };
    }
  }

  isAutomatic1111Reachable = async () => {
    return (await ajaxClient.get("/sd/automatic1111/status"))["is_reachable"]
  }

  getSettings = async () => {
    return (await ajaxClient.get("/settings/general"))["settings"]
  }

  updateSetting = async (settingName, settingValue) => {
    await ajaxClient.post(
      "/settings/general",
      {
        setting_name: settingName,
        setting_value: settingValue,
      },
    )
  }

  getSamplers = async () => {
    if (this.samplersCache.initialized) return this.samplersCache.samplers
    if (this.samplersCache.fetchPromise) return this.samplersCache.fetchPromise
    this.samplersCache.fetchPromise = (async () => {
      try {
        const samplers = (await ajaxClient.get(
          "/sd/automatic1111/samplers",
        ))["samplers"].map(({sampler_name}) => ({samplerName: sampler_name}))
        this.samplersCache.samplers = samplers
        this.samplersCache.initialized = true
        return samplers
      } finally {
        this.samplersCache.fetchPromise = null
      }
    })()
    return this.samplersCache.fetchPromise
  }

  getAvailableModels = async () => {
    if (this.modelsCache.initialized) return this.modelsCache.models
    if (this.modelsCache.fetchPromise) return this.modelsCache.fetchPromise
    const requestVersion = this.modelsCache.requestVersion
    this.modelsCache.fetchPromise = (async () => {
      try {
        const models = (await ajaxClient.get(
          "/sd/automatic1111/models",
        ))["models"].map(({title, hash, is_active}) => ({modelName: title, modelHash: hash, isModelActive: is_active}))
        if (requestVersion === this.modelsCache.requestVersion) {
          this.modelsCache.models = models
          this.modelsCache.initialized = true
          return models
        }
        return this.modelsCache.models
      } finally {
        if (requestVersion === this.modelsCache.requestVersion) this.modelsCache.fetchPromise = null
      }
    })()
    return this.modelsCache.fetchPromise
  }

  refreshAvailableModels = async () => {
    if (this.modelsCache.refreshPromise) return this.modelsCache.refreshPromise
    const requestVersion = ++this.modelsCache.requestVersion
    const refreshPromise = (async () => {
      try {
        const models = (await ajaxClient.post(
          "/sd/automatic1111/models/refresh",
        ))["models"].map(({title, hash, is_active}) => ({modelName: title, modelHash: hash, isModelActive: is_active}))
        if (requestVersion === this.modelsCache.requestVersion) {
          this.modelsCache.models = models
          this.modelsCache.initialized = true
        }
        return models
      } finally {
        if (requestVersion === this.modelsCache.requestVersion) this.modelsCache.fetchPromise = null
        if (requestVersion === this.modelsCache.requestVersion) this.modelsCache.refreshPromise = null
      }
    })()
    this.modelsCache.refreshPromise = refreshPromise
    this.modelsCache.fetchPromise = refreshPromise
    return refreshPromise
  }

  changeCurrentModel = async (modelHash) => {
    await ajaxClient.post(
      "/sd/automatic1111/models/current",
      {model_hash: modelHash},
    )
    if (this.modelsCache.initialized) {
      this.modelsCache.models = this.modelsCache.models.map(model => ({
        ...model,
        isModelActive: model.modelHash === modelHash,
      }))
    }
  }

  enqueueTxt2ImgRequest = async (request) => {
    await ajaxClient.post(
      "/sd/automatic1111/generate/txt2img",
      request,
    )
  }

  enqueueImg2ImgRequest = async (request) => {
    await ajaxClient.post(
      "/sd/automatic1111/generate/img2img",
      request,
    )
  }

  enqueueInpaintRequest = async (request) => {
    await ajaxClient.post(
      "/sd/automatic1111/generate/inpaint",
      request,
    )
  }

  processEnqueuedRequest = async () => {
    await ajaxClient.post(
      "/sd/automatic1111/generate/process",
    )
  }

  getProgress = async () => {
    return (await ajaxClient.post(
      "/sd/automatic1111/progress",
    ))
  }

  stopProcessing = async () => {
    await ajaxClient.post(
      "/sd/automatic1111/generate/stop",
    )
  }

  getAllResults = async ({forceRefresh = false} = {}) => {
    if (this.resultsCache.initialized && !forceRefresh) return this.resultsCache.resultGroups
    if (this.resultsCache.fetchPromise) return this.resultsCache.fetchPromise
    this.resultsCache.fetchPromise = (async () => {
      try {
        const resultGroups = (await ajaxClient.post(
          "/results/get-all",
        ))["result_groups"]
        this.resultsCache.resultGroups = resultGroups
        this.resultsCache.initialized = true
        return resultGroups
      } finally {
        this.resultsCache.fetchPromise = null
      }
    })()
    return this.resultsCache.fetchPromise
  }

  getCachedResults = () => this.resultsCache.initialized ? this.resultsCache.resultGroups : null

  replaceCachedResults = (resultGroups) => {
    this.resultsCache.resultGroups = resultGroups
    this.resultsCache.initialized = true
    return resultGroups
  }

  removeResultFromCache = (imageFileName) => {
    const resultGroups = (this.resultsCache.resultGroups || [])
      .map(group => ({
        ...group,
        group_items: group.group_items.filter(item => item.image_file_name !== imageFileName),
      }))
      .filter(group => group.group_items.length > 0)
    return this.replaceCachedResults(resultGroups)
  }

  removeBatchFromCache = (requestId) => {
    const resultGroups = (this.resultsCache.resultGroups || [])
      .filter(group => group.request_id !== requestId)
    return this.replaceCachedResults(resultGroups)
  }

  deleteResult = async (imageFileName) => ajaxClient.delete(`/results/result/${encodeURIComponent(imageFileName)}`)
  deleteResultBatch = async (requestId) => ajaxClient.delete(`/results/batch/${encodeURIComponent(requestId)}`)

  getStoredPrompts = async () => {
    return (await ajaxClient.get(
      "/settings/prompts",
    ))["prompts"]
  }

  setStoredPrompts = async (prompts) => {
    await ajaxClient.put(
      "/settings/prompts",
      {
        prompts,
      }
    )
  }
}

export const localServerApi = new LocalServerApi();
