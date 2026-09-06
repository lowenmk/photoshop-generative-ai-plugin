const photoshop = require("photoshop");
const {app} = photoshop;
const {executeAsModal} = photoshop.core;
const {batchPlay} = photoshop.action;
const {photoshopApp} = require("../photoshop/PhotoshopApp");
const {DreamTabInternal} = require("../components/tabs/DreamTab");
const {
  InferenceType,
  MaskSource,
  DEFAULT_CFG_SCALE,
  DEFAULT_DENOISING_STRENGTH,
  DEFAULT_DREAM_TAB_SETTINGS,
} = require("../utils/Constants");
const {localServerApi} = require("../api/localServerApi");
const {settingsStorage} = require("../utils/SettingsStorage");
const {getActiveMainPanelInstance} = require("../panels/MainPanel");
const {setFailurePoint, clearFailurePoint} = require("./DevFailureInjector");
const {buildLoraToken, insertLoraToken} = require("../utils/promptUtils");
const {reconcileLoraSelection} = require("../utils/loraUtils");
const {createLoraCache} = require("../api/loraCache");
const {MainTab} = require("../components/common/MainTabSelection");

const HARNESS_REQUEST_PREFIX = "test-phase1-";
const HARNESS_DOCUMENT_PREFIX = "EasySD Harness";
const ownedDocumentIds = new Set();

const dimension = (value) => {
  if (typeof value === "number") return value;
  if (typeof value?._value === "number") return value._value;
  if (typeof value?.value === "number") return value.value;
  return null;
};

const serializeLayer = (layer, parentId = null, depth = 0) => {
  const entry = {
    id: layer?._id ?? null,
    name: layer?.name ?? "",
    type: layer?.kind ?? "unknown",
    visible: Boolean(layer?.visible),
    locked: Boolean(layer?.locked ?? layer?.allLocked ?? layer?.pixelsLocked ?? layer?.positionLocked),
    parentId,
    depth,
  };
  const children = Array.isArray(layer?.layers)
    ? layer.layers.flatMap(child => serializeLayer(child, entry.id, depth + 1))
    : [];
  return [entry, ...children];
};

const serializeDocument = (document) => ({
  id: document?._id ?? null,
  name: document?.name ?? "",
  width: dimension(document?.width),
  height: dimension(document?.height),
});

class PhotoshopDevHarness {
  assertOwnedActiveDocument = () => {
    const activeDocument = app.activeDocument;
    const documentId = activeDocument?._id;
    if (documentId && !ownedDocumentIds.has(documentId) && activeDocument?.name?.startsWith(HARNESS_DOCUMENT_PREFIX)) {
      ownedDocumentIds.add(documentId);
    }
    if (!documentId || !ownedDocumentIds.has(documentId)) {
      throw new Error("Development command requires an active harness-owned document");
    }
    return activeDocument;
  };

  getState = async () => {
    const activeDocument = app.activeDocument || null;
    const selection = activeDocument ? await photoshopApp.getSelectionArea() : null;
    return {
      activeDocument: activeDocument ? serializeDocument(activeDocument) : null,
      documents: app.documents.map(serializeDocument),
      activeLayerId: activeDocument?.activeLayers?.[0]?._id ?? null,
      layers: activeDocument ? activeDocument.layers.flatMap(layer => serializeLayer(layer)) : [],
      selection: selection
        ? {exists: true, left: selection.x, top: selection.y,
          right: selection.x + selection.width, bottom: selection.y + selection.height}
        : {exists: false},
    };
  };

  createTestDocument = async (payload = {}) => {
    let document = null;
    let background = null;
    await executeAsModal(async () => {
      document = await app.documents.add({
        width: Number(payload.width) || 512,
        height: Number(payload.height) || 512,
        resolution: 72,
        mode: "RGBColorMode",
        fill: payload.background === false ? "transparent" : "white",
        name: payload.name || `EasySD Test ${Date.now()}`,
      });
      background = document.backgroundLayer;
      if (payload.lock_background !== false && background) {
        await batchPlay([{
          _obj: "set",
          _target: [{_ref: "layer", _id: background._id}],
          to: {
            _obj: "layer",
            layerLocking: {
              _obj: "layerLocking",
              protectAll: true,
            },
          },
        }], {modalBehavior: "execute"});
      }
    });
    ownedDocumentIds.add(document._id);
    return {document: serializeDocument(document), harnessOwned: true, backgroundId: background?._id ?? null};
  };

  closeTestDocument = async ({document_id: documentId} = {}) => {
    const document = app.documents.find(item => item._id === documentId);
    if (!ownedDocumentIds.has(documentId) && !document?.name?.startsWith(HARNESS_DOCUMENT_PREFIX)) {
      throw new Error("Refusing to close a non-harness document");
    }
    ownedDocumentIds.add(documentId);
    if (!document) { ownedDocumentIds.delete(documentId); return {closed: false, documentId}; }
    await executeAsModal(() => document.closeWithoutSaving());
    ownedDocumentIds.delete(documentId);
    return {closed: true, documentId};
  };

  setSelection = async (payload) => {
    this.assertOwnedActiveDocument();
    const area = {x: Number(payload.left), y: Number(payload.top),
      width: Number(payload.right) - Number(payload.left), height: Number(payload.bottom) - Number(payload.top)};
    if (![area.x, area.y, area.width, area.height].every(Number.isFinite) || area.width <= 0 || area.height <= 0) {
      throw new Error("Selection bounds must define a positive rectangle");
    }
    await photoshopApp.applySelectionArea(area);
    const selection = await photoshopApp.getSelectionArea();
    return {exists: true, left: selection.x, top: selection.y,
      right: selection.x + selection.width, bottom: selection.y + selection.height};
  };

  clearSelection = async () => {
    this.assertOwnedActiveDocument();
    await executeAsModal(() => batchPlay([{
      _obj: "set", _target: [{_ref: "channel", _property: "selection"}],
      to: {_enum: "ordinal", _value: "none"},
    }], {modalBehavior: "execute"}));
    return {exists: false};
  };

  exportCurrentSelectionMask = async (payload = {}) => {
    this.assertOwnedActiveDocument();
    const result = await photoshopApp.exportSelectionAsMask({
      invert: Boolean(payload.invert),
      feather: Number(payload.feather) || 0,
      expand: Number(payload.expand) || 0,
    });
    return {result, state: await this.getState()};
  };

  createTestMaskLayer = async () => {
    const document = this.assertOwnedActiveDocument();
    const sourceLayer = document.activeLayers[0];
    await photoshopApp.applySelectionArea({x: 96, y: 96, width: 320, height: 320});
    const maskLayerId = await photoshopApp.createLayer("Mask Layer Harness");
    await photoshopApp.activateLayer(maskLayerId);
    await executeAsModal(() => batchPlay([{
      _obj: "fill",
      using: {_enum: "fillContents", _value: "white"},
      opacity: {_unit: "percentUnit", _value: 100},
      mode: {_enum: "blendMode", _value: "normal"},
    }], {modalBehavior: "execute"}));
    await photoshopApp.activateLayer(sourceLayer._id);
    return {documentId: document._id, sourceLayerId: sourceLayer._id, maskLayerId};
  };

  generate = async (payload) => {
    const document = this.assertOwnedActiveDocument();
    const inferenceType = payload.inference_type;
    const maskSource = payload.mask_source || MaskSource.MASK_LAYER;
    if (inferenceType === InferenceType.INPAINT &&
        ![MaskSource.MASK_LAYER, MaskSource.CURRENT_SELECTION].includes(maskSource)) {
      throw new Error(`Invalid inpaint mask source: ${String(maskSource)}`);
    }
    const sourceLayer = document.activeLayers[0];
    let maskLayerId = null;
    if (inferenceType === InferenceType.INPAINT && maskSource === MaskSource.MASK_LAYER) {
      const mask = await this.createTestMaskLayer();
      maskLayerId = mask.maskLayerId;
    } else if (inferenceType === InferenceType.INPAINT && maskSource === MaskSource.CURRENT_SELECTION) {
      await photoshopApp.applySelectionArea(payload.selection || {x: 96, y: 96, width: 320, height: 320});
    }

    const result = {groups: null, requestId: null};
    let generationError = null;
    const dreamTab = new DreamTabInternal({
      sourceLayer: {_id: sourceLayer._id},
      requestIdPrefix: HARNESS_REQUEST_PREFIX.slice(0, -1),
      seed: -1,
      cfgScale: DEFAULT_CFG_SCALE,
      denoisingStrength: DEFAULT_DENOISING_STRENGTH,
      onProgress: () => {},
      onBeforeDreamButtonClicked: async () => {},
      onSourceLayerChange: () => {},
      onResults: (groups, requestId) => {
        result.groups = groups;
        result.requestId = requestId;
      },
      onGenerationError: (message) => {
        generationError = message;
      },
      onIsLoadingModelsChange: () => {},
      alertContext: {setError: () => {}},
    });
    dreamTab.state = {
      ...dreamTab.state,
      prompt: payload.prompt || "harness regression",
      negativePrompt: "",
      imageCount: 1,
      samplingSteps: Number(payload.sampling_steps) || 5,
      cfgScale: DEFAULT_CFG_SCALE,
      seed: -1,
      denoisingStrength: DEFAULT_DENOISING_STRENGTH,
      inferenceType,
      maskSource,
      maskBlur: DEFAULT_DREAM_TAB_SETTINGS.maskBlur,
      maskedContent: DEFAULT_DREAM_TAB_SETTINGS.maskedContent,
      selectionInvert: Boolean(payload.selection_invert),
      selectionFeather: payload.selection_feather === undefined
        ? DEFAULT_DREAM_TAB_SETTINGS.selectionFeather
        : Number(payload.selection_feather),
      selectionExpand: payload.selection_expand === undefined
        ? DEFAULT_DREAM_TAB_SETTINGS.selectionExpand
        : Number(payload.selection_expand),
    };
    if (inferenceType === InferenceType.INPAINT) {
      if (dreamTab.state.inferenceType !== InferenceType.INPAINT) {
        throw new Error("Harness inpaint assertion failed: inferenceType is not INPAINT");
      }
      if (dreamTab.state.maskSource !== maskSource) {
        throw new Error("Harness inpaint assertion failed: maskSource does not match the requested mode");
      }
    }
    await dreamTab.onDreamButtonClick();
    if (generationError) {
      throw new Error(`Production ${inferenceType} workflow failed: ${generationError}`);
    }
    if (!result.groups || !result.requestId) {
      throw new Error(`Production ${inferenceType} workflow did not return a result batch`);
    }
    const group = result.groups.find(item => item.request_id === result.requestId);
    if (!group || !group.group_items || group.group_items.length === 0) {
      throw new Error(`Production ${inferenceType} workflow returned no results for ${result.requestId}`);
    }
    return {
      inferenceType,
      requestId: result.requestId,
      group,
      maskLayerId,
      state: await this.getState(),
    };
  };

  cleanupResultBatch = async ({request_id: requestId} = {}) => {
    if (!requestId || !requestId.startsWith("test-phase1-")) {
      throw new Error("Refusing to delete a non-harness result batch");
    }
    await localServerApi.deleteResultBatch(requestId);
    return {deleted: true, requestId};
  };

  modelSettingsRoundTrip = async () => {
    const panel = getActiveMainPanelInstance();
    if (!panel) throw new Error("MainPanel is not ready for model settings testing");
    const models = await localServerApi.refreshAvailableModels();
    const usableModels = models.filter(model => typeof model.modelHash === "string" && model.modelHash.length > 0);
    const modelA = usableModels.find(model => model.isModelActive);
    const modelB = usableModels.find(model => model.modelHash !== modelA?.modelHash);
    if (usableModels.length < 2) return {skipped: true, reason: "Fewer than two hashed checkpoints are installed"};
    if (!modelA || !modelB) return {skipped: true, reason: "Could not determine the active hashed checkpoint"};

    const samplers = await localServerApi.getSamplers();
    if (samplers.length < 2) return {skipped: true, reason: "Fewer than two samplers are available"};
    const originalHash = modelA.modelHash;
    const originalSettings = panel.getCurrentModelSettings();
    const originalProfiles = {
      [modelA.modelHash]: settingsStorage.hasModelSettings(modelA.modelHash)
        ? settingsStorage.getModelSettings(modelA.modelHash) : null,
      [modelB.modelHash]: settingsStorage.hasModelSettings(modelB.modelHash)
        ? settingsStorage.getModelSettings(modelB.modelHash) : null,
    };
    const settingsA = {
      samplingMethod: samplers[0].samplerName, samplingSteps: 21, cfgScale: 5,
      denoisingStrength: 0.42, seed: 12345, restoreFaces: false, maskBlur: 8, maskedContent: "original",
    };
    const settingsB = {
      samplingMethod: samplers[1].samplerName, samplingSteps: 37, cfgScale: 9,
      denoisingStrength: 0.81, seed: 67890, restoreFaces: true, maskBlur: 24, maskedContent: "latent noise",
    };
    const waitForState = () => new Promise(resolve => setTimeout(resolve, 100));
    const sameSettings = (left, right) => Object.keys(settingsA).every(key => left[key] === right[key]);
    try {
      if (panel.state.activeModelHash !== modelA.modelHash) {
        await panel.onModelChangeRequested(modelA.modelHash);
      }
      panel.applyModelSettings(settingsA);
      await waitForState();
      await panel.onModelChangeRequested(modelB.modelHash);
      panel.applyModelSettings(settingsB);
      await waitForState();
      await panel.onModelChangeRequested(modelA.modelHash);
      await waitForState();
      const restoredA = panel.getCurrentModelSettings();
      if (!sameSettings(restoredA, settingsA)) throw new Error("Model A settings were not restored");
      await panel.onModelChangeRequested(modelB.modelHash);
      await waitForState();
      const restoredB = panel.getCurrentModelSettings();
      if (!sameSettings(restoredB, settingsB)) throw new Error("Model B settings were not restored");
      const refreshedModels = await localServerApi.refreshAvailableModels();
      const refreshedActive = refreshedModels.find(model => model.isModelActive)?.modelHash;
      if (refreshedActive !== modelB.modelHash) throw new Error("Model refresh changed the active model unexpectedly");
      const reloadSettings = settingsStorage.getModelSettings(modelB.modelHash);
      if (!sameSettings(reloadSettings, settingsB)) throw new Error("Model settings did not survive reload read");
      return {skipped: false, modelA: modelA.modelHash, modelB: modelB.modelHash,
        restoredA: true, restoredB: true, refreshPreservedActiveModel: true, reloadPreservedSettings: true};
    } finally {
      try {
        if (panel.state.activeModelHash !== originalHash) await panel.onModelChangeRequested(originalHash);
        panel.applyModelSettings(originalSettings);
        await waitForState();
      } finally {
        for (const model of [modelA, modelB]) {
          const profile = originalProfiles[model.modelHash];
          if (profile) settingsStorage.saveModelSettings(model.modelHash, profile);
          else settingsStorage.removeModelSettings(model.modelHash);
        }
      }
    }
  };

  loraPromptTokens = async () => ({
    token: buildLoraToken("test-lora", 0.8),
    empty: insertLoraToken("", "test-lora", 0.8),
    appended: insertLoraToken("portrait", "test-lora", 0.8),
    replaced: insertLoraToken("portrait, <lora:test-lora:0.2>", "test-lora", 0.8),
    multiple: insertLoraToken(insertLoraToken("portrait", "one", 0.7), "two", 0.5),
    negativePrompt: "soft focus",
  });

  historyUsePromptRemount = async () => {
    const panel = getActiveMainPanelInstance();
    if (!panel) throw new Error("MainPanel is not ready for History prompt testing");
    const originalHash = panel.state.activeModelHash;
    const originalPrompt = panel.dreamTabRef?.state.prompt || "";
    const originalNegativePrompt = panel.dreamTabRef?.state.negativePrompt || "";
    const waitForRender = () => new Promise(resolve => setTimeout(resolve, 100));
    try {
      panel.onCurrentTabChange(MainTab.RESULTS);
      await waitForRender();
      if (panel.dreamTabRef) throw new Error("DreamTab did not unmount for History test");
      panel.onUsePrompt("phase2-history-positive", "phase2-history-negative");
      await waitForRender();
      const dreamTab = panel.dreamTabRef;
      if (!dreamTab) throw new Error("DreamTab did not remount after Use Prompt");
      if (dreamTab.state.prompt !== "phase2-history-positive" || dreamTab.state.negativePrompt !== "phase2-history-negative") {
        throw new Error("History prompt values were not applied after remount");
      }
      if (panel.state.activeModelHash !== originalHash) throw new Error("Use Prompt changed the active model");
      return {prompt: dreamTab.state.prompt, negativePrompt: dreamTab.state.negativePrompt, activeModelHash: panel.state.activeModelHash};
    } finally {
      if (panel.dreamTabRef) panel.dreamTabRef.applyPromptSettings(originalPrompt, originalNegativePrompt);
      panel.setState({currentTab: MainTab.DREAM});
      await waitForRender();
    }
  };

  historyReuseSamplerStepsRemount = async () => {
    const panel = getActiveMainPanelInstance();
    if (!panel) throw new Error("MainPanel is not ready for History settings testing");
    const originalHash = panel.state.activeModelHash;
    const originalSettings = panel.getCurrentModelSettings();
    const samplers = await localServerApi.getSamplers();
    if (!samplers.length) throw new Error("No samplers available for History settings test");
    const requestedSampler = samplers[0].samplerName;
    const requestedSteps = 47;
    const waitForRender = () => new Promise(resolve => setTimeout(resolve, 100));
    try {
      panel.onCurrentTabChange(MainTab.RESULTS);
      await waitForRender();
      if (panel.dreamTabRef) throw new Error("DreamTab did not unmount for History settings test");
      await panel.onSamplingMethodChange(requestedSampler);
      panel.onSamplingStepsChange(requestedSteps);
      panel.onCurrentTabChange(MainTab.DREAM);
      await waitForRender();
      const dreamTab = panel.dreamTabRef;
      if (!dreamTab || dreamTab.state.samplingMethod !== requestedSampler || dreamTab.state.samplingSteps !== requestedSteps) {
        throw new Error("History sampler/steps were not applied after remount");
      }
      if (panel.state.activeModelHash !== originalHash) throw new Error("History settings changed the active model");
      const profile = panel.getCurrentModelSettings();
      if (profile.samplingMethod !== requestedSampler || profile.samplingSteps !== requestedSteps) {
        throw new Error("History sampler/steps did not update the active model profile");
      }
      return {samplingMethod: requestedSampler, samplingSteps: requestedSteps, activeModelHash: panel.state.activeModelHash};
    } finally {
      if (panel.dreamTabRef) {
        if (originalSettings.samplingMethod) await panel.onSamplingMethodChange(originalSettings.samplingMethod);
        if (originalSettings.samplingSteps) panel.onSamplingStepsChange(originalSettings.samplingSteps);
      }
      panel.setState({currentTab: MainTab.DREAM});
      await waitForRender();
    }
  };

  loraRefreshRace = async () => {
    let resolveFetch;
    let resolveRefresh;
    const cache = createLoraCache(
      () => new Promise(resolve => { resolveFetch = resolve; }),
      () => new Promise(resolve => { resolveRefresh = resolve; }),
    );
    const fetchPromise = cache.get();
    const refreshPromise = cache.refresh();
    resolveRefresh([{name: "refresh-result"}]);
    await refreshPromise;
    resolveFetch([{name: "stale-result"}]);
    await fetchPromise;
    const final = await cache.get();
    if (final[0]?.name !== "refresh-result") throw new Error("Stale LoRA fetch overwrote refreshed cache");
    return {finalName: final[0].name};
  };

  loraSelectionReconciliation = async () => {
    const preserved = reconcileLoraSelection([{name: "lora-one"}, {name: "lora-two"}], "lora-two");
    const replaced = reconcileLoraSelection([{name: "lora-one"}], "lora-two");
    const empty = reconcileLoraSelection([], "lora-one");
    if (preserved !== "lora-two" || replaced !== "lora-one" || empty !== "") throw new Error("LoRA selection reconciliation failed");
    return {preserved, replaced, empty};
  };

  exportCurrentSelectionMask = async (payload = {}) => {
    this.assertOwnedActiveDocument();
    const result = await photoshopApp.exportSelectionAsMask({
      invert: Boolean(payload.invert),
      feather: Number(payload.feather) || 0,
      expand: Number(payload.expand) || 0,
    });
    return {result, state: await this.getState()};
  };

  placeNewLayer = async (payload) => {
    const document = this.assertOwnedActiveDocument();
    const layer = await photoshopApp.openImageAsLayerInDocument(
      document._id, payload.layer_name || "Result Test", payload.image_file_name,
    );
    return {documentId: document._id, layerId: layer?._id ?? null, state: await this.getState()};
  };

  placeReplaceArea = async (payload) => {
    const document = this.assertOwnedActiveDocument();
    await photoshopApp.placeResultOverSelectedArea(
      document._id, payload.layer_name || "Result Test", payload.image_file_name,
      payload.request_id || "harness-request", payload.prompt || "Harness test",
    );
    return {documentId: document._id, state: await this.getState()};
  };

  placeOpenImage = async (payload) => {
    this.assertOwnedActiveDocument();
    const sourceDocumentId = app.activeDocument._id;
    const sourceState = await this.getState();
    const document = await photoshopApp.openResultAsNewDocument(payload.image_file_name);
    ownedDocumentIds.add(document._id);
    return {sourceDocumentId, openedDocument: serializeDocument(document), sourceState, state: await this.getState()};
  };

  execute = async (commandType, payload) => {
    switch (commandType) {
      case "get_state": return this.getState();
      case "create_test_document": return this.createTestDocument(payload);
      case "close_test_document": return this.closeTestDocument(payload);
      case "set_selection": return this.setSelection(payload);
      case "clear_selection": return this.clearSelection();
      case "export_current_selection_mask": return this.exportCurrentSelectionMask(payload);
      case "generate_txt2img": return this.generate({...payload, inference_type: InferenceType.TXT_2_IMG});
      case "generate_img2img": return this.generate({...payload, inference_type: InferenceType.IMG_2_IMG});
      case "generate_inpaint": return this.generate({...payload, inference_type: InferenceType.INPAINT});
      case "cleanup_result_batch": return this.cleanupResultBatch(payload);
      case "model_settings_round_trip": return this.modelSettingsRoundTrip();
      case "lora_prompt_tokens": return this.loraPromptTokens();
      case "history_use_prompt_remount": return this.historyUsePromptRemount();
      case "history_reuse_sampler_steps_remount": return this.historyReuseSamplerStepsRemount();
      case "lora_refresh_race": return this.loraRefreshRace();
      case "lora_selection_reconciliation": return this.loraSelectionReconciliation();
      case "place_new_layer": return this.placeNewLayer(payload);
      case "place_replace_area": return this.placeReplaceArea(payload);
      case "place_open_image": return this.placeOpenImage(payload);
      case "set_failure_mode": setFailurePoint(payload.failure_point); return {failurePoint: payload.failure_point};
      case "clear_failure_mode": clearFailurePoint(); return {failurePoint: null};
      default: throw new Error(`Unsupported development command: ${commandType}`);
    }
  };
}

export const photoshopDevHarness = new PhotoshopDevHarness();
