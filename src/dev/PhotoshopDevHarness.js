const photoshop = require("photoshop");
const {app} = photoshop;
const {executeAsModal} = photoshop.core;
const {batchPlay} = photoshop.action;
const {photoshopApp} = require("../photoshop/PhotoshopApp");
const {setFailurePoint, clearFailurePoint} = require("./DevFailureInjector");

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
    const documentId = app.activeDocument?._id;
    if (!documentId || !ownedDocumentIds.has(documentId)) {
      throw new Error("Development command requires an active harness-owned document");
    }
    return app.activeDocument;
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
    if (!ownedDocumentIds.has(documentId)) throw new Error("Refusing to close a non-harness document");
    const document = app.documents.find(item => item._id === documentId);
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
      case "export_current_selection_mask": return this.exportCurrentSelectionMask(payload);
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
