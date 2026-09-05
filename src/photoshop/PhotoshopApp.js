const {UiError} = require("../exceptions/Exceptions");

const photoshop = require('photoshop')
const uxp = require('uxp')

const {executeAsModal} = photoshop.core;
const {batchPlay} = photoshop.action;
const {app} = photoshop;
const {ElementPlacement} = photoshop.constants || {};
const fs = uxp.storage.localFileSystem;
const {formats} = uxp.storage;
const RESULTS_STATIC_URL = "http://localhost:8088/static";
const RESULT_GROUP_NAME_REGEX = /[^a-zA-Z0-9\-_]+/g;

const describeThrownValue = (error) => {
  let json = null;
  try {
    json = JSON.stringify(error);
  } catch (serializationError) {
    json = `<unserializable: ${serializationError}>`;
  }
  return {
    typeofError: typeof error,
    stringValue: String(error),
    name: error?.name,
    message: error?.message,
    stack: error?.stack,
    json,
  };
};

const extractBatchPlayLayerId = (operation, result) => {
  const diagnostics = {
    operation,
    isArray: Array.isArray(result),
    length: Array.isArray(result) ? result.length : null,
    result,
  };
  console.log(`[EasySD] Background BatchPlay result: ${JSON.stringify(diagnostics)}`);
  const first = Array.isArray(result) ? result[0] : result;
  const candidate = first?.ID?.[0] ?? first?.layerID ?? first?.id ?? first?.layerId;
  console.log(`[EasySD] Background BatchPlay identifier extraction: ${JSON.stringify({operation, first, candidate})}`);
  if (candidate === undefined || candidate === null) {
    throw new UiError(`Photoshop did not return a layer ID for ${operation}`);
  }
  return candidate;
};

// photoshop.action.addNotificationListener(['all'], (event, descriptor) => {
//   console.log("Event:" + event + " Descriptor: " + JSON.stringify(descriptor))
// });

// Any layer with this prefix is considered to be a mask layer
// This is convenient because user can duplicate a Mask Layer, and get Mask Layer Copy that will also be a mask layer
const MASK_LAYER_NAME_PREFIX = "Mask Layer"

export class PhotoshopApp {
  maskLayerCounter;

  constructor() {
    this.maskLayerCounter = 1
  }

  hasActiveDocument = () => {
    return !!app.activeDocument
  }

  showAlert = (message) => {
    app.showAlert(message);
  }

  getActiveDocument = () => {
    return app.activeDocument;
  }

  getActiveLayer = () => {
    let activeLayers = app.activeDocument.activeLayers
    return activeLayers[0]
  }

  setForegroundColor = async (red, green, blue) => {
    try {
      await executeAsModal(async () => {
        const color = new app.SolidColor();
        color.rgb.red = red;
        color.rgb.green = green;
        color.rgb.blue = blue
        app.foregroundColor = color
      })
    } catch (e) {
      console.error(e);
    }
  }

  pickTool = async (toolName) => {
    await executeAsModal(async () => {
      return await batchPlay(
        [
          {
            _obj: 'select',
            "_target": [{"_ref": toolName}],
          }
        ],
        {
          // synchronousExecution: true,
          modalBehavior: 'execute'
        }
      )
    })
  }

  maybeGetLayerById = (layerId) => {
    const layers = app.activeDocument.layers;
    return layers.find(l => l._id === layerId);
  }

  getAllLayers = () => {
    return app.activeDocument.layers;
  }

  getVisibleLayers = () => {
    return app.activeDocument.layers.filter(layer => layer.visible);
  }

  getLayerById = (layerId) => {
    const layer = this.maybeGetLayerById(layerId)
    if (!layer) {
      console.error(`Could not find layer with id ${layerId}`)
      throw new UiError(
        "Something went wrong. Please make sure you are following the right steps when doing image generation. " +
        "Otherwise please contact the developer."
      )
    }
    return layer
  }

  checkLayerExists = (layerId) => {
    this.getLayerById(layerId)
  }

  createLayer = async (layerName = null) => {
    const command = {
      "_obj": "make",
      "_target": [{"_ref": "layer"}],
    }
    if (layerName) {
      command["using"] = {"_obj": "layer", "name": layerName}
    }
    const result = await executeAsModal(async () => {
      return await batchPlay(
        [
          command,
        ],
        {
          // synchronousExecution: true,
          modalBehavior: 'execute'
        }
      )
    })
    const layerId = result[0].layerID;
    // checkLayerExists(layerId);
    return layerId;
  }

  createMaskLayer = async () => {
    const layerName = `${MASK_LAYER_NAME_PREFIX} ${this.maskLayerCounter++}`;
    await this.createLayer(layerName);
    return layerName;
  }

  isMaskLayer = (layer) => {
    return layer.name.startsWith(MASK_LAYER_NAME_PREFIX);
  }

  clearMaskLayers = async () => {
    const maskLayers = this.getMaskLayers()
    for (let maskLayer of maskLayers) {
      await this.deleteLayer(maskLayer._id)
      // await new Promise(r => setTimeout(r, 2000));
    }
  }

  getMaskLayers = () => {
    // Anything that starts with MASK_LAYER_NAME_PREFIX is considered a mask layer
    const layers = app.activeDocument.layers;
    return layers.filter(this.isMaskLayer)
  }

  getLatestVisibleMaskLayer = () => {
    const maskLayers = this.getMaskLayers()
    const visibleMaskLayerIds = maskLayers
      .filter(layer => layer.visible)
      .map(layer => layer._id)

    if (visibleMaskLayerIds.length === 0) {
      throw new UiError(
        "No visible mask layers found! Please make sure to use 'New Mask Layer' button to create " +
        "some mask layers"
      );
    }
    const mostRecentlyCreatedVisibleMaskLayerId = Math.max(...visibleMaskLayerIds)
    const maskLayer = this.getLayerById(mostRecentlyCreatedVisibleMaskLayerId);
    return maskLayer
  }

  getTopVisibleLayerId = () => {
    const visibleLayerIds = app.activeDocument.layers
      .filter(layer => layer.visible)
      .map(layer => layer._id)
    return visibleLayerIds.length >= 1
      ? visibleLayerIds[0]
      : null;
  }

  deleteLayer = async (layerId) => {
    await executeAsModal(async () => {
      return await batchPlay(
        [
          {
            "_obj": "delete",
            _target: {_ref: 'layer', _id: layerId},
          },
        ],
        {
          synchronousExecution: true,
          modalBehavior: 'execute'
        }
      )
    })
  }

  getSelectionArea = async () => {
    const result = await executeAsModal(async () => {
      return await batchPlay(
        [
          {
            _obj: 'get',
            _target: [
              {
                _property: 'selection'
              },
              {
                _ref: 'document',
                _id: app.activeDocument._id
              }
            ],
            _options: {
              dialogOptions: 'dontDisplay'
            }
          }
        ],
        {
          synchronousExecution: false,
          modalBehavior: 'execute'
        }
      )
    })
    const selection = result[0]?.selection
    if (!selection) {
      return null
    }
    return {
      x: selection.left._value,
      y: selection.top._value,
      width: selection.right._value - selection.left._value,
      height: selection.bottom._value - selection.top._value,
    }
  }

  getLayerBounds = (layer) => {
    return {
      x: layer.bounds.left,
      y: layer.bounds.top,
      width: layer.bounds.right - layer.bounds.left,
      height: layer.bounds.bottom - layer.bounds.top,
    }
  }

  applySelectionArea = async (selectionArea) => {
    await executeAsModal(async () => {
      await batchPlay(
        [
          {
            _obj: 'set',
            "_target": [{"_ref": "channel", "_property": "selection"}],
            "to": {
              "_obj": "rectangle",
              "left": {"_unit": "pixelsUnit", "_value": selectionArea.x},
              "top": {"_unit": "pixelsUnit", "_value": selectionArea.y},
              "right": {"_unit": "pixelsUnit", "_value": selectionArea.x + selectionArea.width},
              "bottom": {"_unit": "pixelsUnit", "_value": selectionArea.y + selectionArea.height},
            },
          }
        ],
        {
          // synchronousExecution: true,
          modalBehavior: 'execute'
        }
      )
    })
  }

  applyFullDocumentSelection = async () => {
    await executeAsModal(async () => {
      await batchPlay(
        [
          {
            _obj: 'set',
            "_target": [{"_ref": "channel", "_property": "selection"}],
            "to":{"_enum":"ordinal","_value":"allEnum"}
          }
        ],
        {
          // synchronousExecution: true,
          modalBehavior: 'execute'
        }
      )
    })
  }

  applyLayerMinimalSelectionArea = async (layerId) => {
    // checkLayerExists(layerId);
    await executeAsModal(async () => {
      await batchPlay(
        [
          {
            "_obj": "set",
            "_target": [{"_ref": "channel", "_property": "selection"}],
            "to": {
              "_ref": [
                {"_ref": "channel", "_enum": "channel", "_value": "transparencyEnum"},
                {"_ref": "layer", "id": layerId}
              ]
            }
          },
        ],
        {
          // synchronousExecution: true,
          modalBehavior: 'execute'
        }
      )
    })
  }

  // Export a normal Photoshop selection without changing any source or mask layer.
  // The temporary layer is transparent outside the selection; the bridge already
  // converts that alpha channel into its expected black-and-white mask.
  exportSelectionAsMask = async ({invert = false, feather = 0, expand = 0} = {}) => {
    const document = this.getActiveDocument();
    const originalLayer = this.getActiveLayer();
    console.log(`[EasySD] Current Selection mask start: ${JSON.stringify({
      documentId: document?._id,
      originalLayerId: originalLayer?._id,
      invert,
      feather,
      expand,
    })}`)
    console.log("[EasySD] Current Selection mask: reading original selection bounds")
    const selectionArea = await this.getSelectionArea();
    console.log(`[EasySD] Current Selection mask: original selection bounds ${JSON.stringify(selectionArea)}`)
    if (!selectionArea) {
      throw new UiError("Please create a Photoshop selection before using Current Selection as the mask.");
    }

    console.log("[EasySD] Current Selection mask: creating temporary mask layer")
    const temporaryLayerId = await this.createLayer("EasySD Temporary Selection Mask");
    const selectionBackupName = `EasySD Selection Backup ${Date.now()}`;
    let selectionBackupId = null;
    try {
      console.log(`[EasySD] Current Selection mask: activating temporary layer ${temporaryLayerId}`)
      await this.activateLayer(temporaryLayerId);
      await executeAsModal(async () => {
        console.log(`[EasySD] Current Selection mask: saving original selection as ${selectionBackupName}`)
        const backupResult = await batchPlay([
          {
            _obj: "duplicate",
            _target: [{_ref: "channel", _property: "selection"}],
            name: selectionBackupName,
          },
        ], {modalBehavior: "execute"});
        selectionBackupId = backupResult[0]?.ID ?? backupResult[0]?.channelID ?? null;
        console.log(`[EasySD] Current Selection mask: selection backup created ${JSON.stringify({selectionBackupId, backupResult})}`)
        const commands = [];
        if (expand > 0) {
          console.log(`[EasySD] Current Selection mask: expanding selection by ${expand}`)
          commands.push({
            _obj: "expand",
            _target: [{_ref: "channel", _property: "selection"}],
            by: {_unit: "pixelsUnit", _value: expand},
          });
        } else if (expand < 0) {
          console.log(`[EasySD] Current Selection mask: contracting selection by ${Math.abs(expand)}`)
          commands.push({
            _obj: "contract",
            _target: [{_ref: "channel", _property: "selection"}],
            by: {_unit: "pixelsUnit", _value: Math.abs(expand)},
          });
        }
        if (feather > 0) {
          console.log(`[EasySD] Current Selection mask: feathering selection by ${feather}`)
          commands.push({
            _obj: "feather",
            _target: [{_ref: "channel", _property: "selection"}],
            radius: {_unit: "pixelsUnit", _value: feather},
          });
        }
        if (invert) {
          console.log("[EasySD] Current Selection mask: inverting selection")
          commands.push({
            _obj: "inverse",
            _target: [{_ref: "channel", _property: "selection"}],
          });
        }
        if (commands.length > 0) {
          await batchPlay(commands, {modalBehavior: "execute"});
          console.log("[EasySD] Current Selection mask: selection transformation complete")
        }
        console.log("[EasySD] Current Selection mask: filling temporary layer")
        await batchPlay([
          {
            _obj: "fill",
            using: {_enum: "fillContents", _value: "white"},
            opacity: {_unit: "percentUnit", _value: 100},
            mode: {_enum: "blendMode", _value: "normal"},
          },
        ], {modalBehavior: "execute"});
        console.log("[EasySD] Current Selection mask: temporary layer fill complete")
      });

      const maskFileName = `doc${document._id}-selection-mask`;
      console.log(`[EasySD] Current Selection mask: exporting temporary layer as ${maskFileName}.png`)
      const maskImagePath = await this.saveLayerAsImage(
        this.getLayerById(temporaryLayerId),
        maskFileName,
        "png",
      );
      console.log(`[EasySD] Current Selection mask: export complete ${maskImagePath}`)
      const transformedArea = await this.getSelectionArea();
      console.log(`[EasySD] Current Selection mask: transformed selection bounds ${JSON.stringify(transformedArea)}`)
      return {
        mask_image_path: maskImagePath,
        mask_image_x: transformedArea?.x ?? selectionArea.x,
        mask_image_y: transformedArea?.y ?? selectionArea.y,
        effective_selection_area: transformedArea ?? selectionArea,
      };
    } catch (e) {
      console.error(`[EasySD] Current Selection mask failed: ${JSON.stringify(describeThrownValue(e))}`)
      throw e;
    } finally {
      console.log("[EasySD] Current Selection mask: restoring original selection")
      try {
        if (selectionBackupId !== null) {
          await executeAsModal(async () => {
            await batchPlay([
              {
                _obj: "set",
                _target: [{_ref: "channel", _property: "selection"}],
                to: {_ref: "channel", _id: selectionBackupId},
              },
              {
                _obj: "delete",
                _target: {_ref: "channel", _id: selectionBackupId},
              },
            ], {modalBehavior: "execute"});
          });
          console.log("[EasySD] Current Selection mask: original selection restored and backup deleted")
        }
      } catch (e) {
        console.error(`[EasySD] Current Selection mask: selection restore failed ${JSON.stringify(describeThrownValue(e))}`)
      }
      try {
        console.log(`[EasySD] Current Selection mask: deleting temporary layer ${temporaryLayerId}`)
        await this.deleteLayer(temporaryLayerId);
        console.log("[EasySD] Current Selection mask: temporary layer deleted")
      } catch (e) {
        console.error(`[EasySD] Current Selection mask: temporary layer cleanup failed ${JSON.stringify(describeThrownValue(e))}`)
      }
      try {
        if (originalLayer) {
          await this.activateLayer(originalLayer._id);
          console.log(`[EasySD] Current Selection mask: original layer restored ${originalLayer._id}`)
        }
      } catch (e) {
        console.error(`[EasySD] Current Selection mask: original layer restore failed ${JSON.stringify(describeThrownValue(e))}`)
      }
    }
  }

  activateLayer = async (layerId) => {
    // checkLayerExists(layerId)
    await executeAsModal(async () => {
      return await batchPlay(
        [
          {
            _obj: 'select',
            _target: {_ref: 'layer', _id: layerId},
            "makeVisible": false,
          }
        ],
        {
          synchronousExecution: true,
          modalBehavior: 'execute'
        }
      )
    })
  }

  renameLayer = async (layerId, newLayerName) => {
    // checkLayerExists(layerId)
    await executeAsModal(async () => {
      return await batchPlay(
        [
          {
            _obj: 'set',
            _target: {_ref: 'layer', _id: layerId},
            to: {_obj: "layer", name: newLayerName},
            // "makeVisible": false,
          }
        ],
        {
          // synchronousExecution: true,
          modalBehavior: 'execute'
        }
      )
    })
  }

  changeBackgroundToLayer = async () => {
    return await executeAsModal(async () => {
      const result = await batchPlay(
        [
          {
            _obj: 'set',
            "_target": [
              {"_ref": "layer", "_property": "background"}
            ],
            "to": {
              "_obj": "layer",
              "opacity": {"_unit": "percentUnit", "_value": 100},
              "mode": {"_enum": "blendMode", "_value": "normal"},
            },
          }
        ],
        {
          // synchronousExecution: true,
          modalBehavior: 'execute'
        }
      )
      return extractBatchPlayLayerId("changeBackgroundToLayer", result)
    })
  }

  duplicateLayer = async (layerId, layerName) => {
    const beforeLayerIds = app.activeDocument.layers.map(layer => layer._id)
    console.log(`[EasySD] Background duplicate before layer IDs: ${JSON.stringify(beforeLayerIds)}`)
    return await executeAsModal(async () => {
      const result = await batchPlay(
        [
          {
            _obj: 'duplicate',
            "_target": [
              {_ref: 'layer', _id: layerId},
            ],
            "name": layerName,
          }
        ],
        {
          // synchronousExecution: true,
          modalBehavior: 'execute'
        }
      )
      console.log(`[EasySD] Background duplicate BatchPlay result: ${JSON.stringify({
        isArray: Array.isArray(result),
        length: Array.isArray(result) ? result.length : null,
        result,
      })}`)
      const afterLayerIds = app.activeDocument.layers.map(layer => layer._id)
      const newLayerIds = afterLayerIds.filter(id => !beforeLayerIds.includes(id))
      console.log(`[EasySD] Background duplicate after layer IDs: ${JSON.stringify(afterLayerIds)}`)
      console.log(`[EasySD] Background duplicate detected new layer IDs: ${JSON.stringify(newLayerIds)}`)
      if (newLayerIds.length !== 1) {
        throw new UiError(`Expected exactly one duplicated layer, detected ${newLayerIds.length}`)
      }
      return newLayerIds[0]
    })
  }

  maybeChangeBackgroundToLayer = async (layerId) => {
    const backgroundLayerId = app.activeDocument.backgroundLayer?._id
    if (backgroundLayerId !== layerId) {
      return layerId;
    }
    const newLayerId = await this.changeBackgroundToLayer()
    await this.renameLayer(newLayerId, "Background")
    return newLayerId;
  }

  isBackgroundLayer = (layerId) => {
    return layerId === app.activeDocument.backgroundLayer?._id
  }

  getExportFolder = async () => {
    const tempRoot = await fs.getTemporaryFolder()
    console.log(`[EasySD] Export temp root: ${tempRoot.nativePath}`)
    try {
      const outputFolder = await tempRoot.getEntry("output")
      console.log(`[EasySD] Export output folder exists: ${outputFolder.nativePath}`)
      return outputFolder
    } catch (e) {
      const outputFolder = await tempRoot.createFolder("output")
      console.log(`[EasySD] Export output folder created: ${outputFolder.nativePath}`)
      return outputFolder
    }
  }

  getImportFile = async (fileNameWithoutPath) => {
    const resultUrl = `${RESULTS_STATIC_URL}/${encodeURIComponent(fileNameWithoutPath)}`;
    const tempFolder = await fs.getTemporaryFolder();
    const tempFileName = `result-import-${fileNameWithoutPath}`;
    console.log(`[EasySD] Result HTTP import diagnostics: ${JSON.stringify({
      resultFileName: fileNameWithoutPath,
      resultUrl,
      tempFolderNativePath: tempFolder.nativePath,
      tempFileName,
      filesystemApi: {
        getTemporaryFolder: typeof fs.getTemporaryFolder,
        createFile: typeof tempFolder.createFile,
        fileWriteFormat: typeof formats?.binary,
      },
    })}`)
    try {
      const response = await fetch(resultUrl);
      const contentType = response.headers?.get("content-type") ?? null;
      if (!response.ok) {
        throw new Error(`Result HTTP request failed with status ${response.status}`);
      }
      const imageBytes = await response.arrayBuffer();
      const tempFile = await tempFolder.createFile(tempFileName, {overwrite: true});
      const bytesWritten = await tempFile.write(imageBytes, {format: formats.binary});
      console.log(`[EasySD] Result temp file written: ${JSON.stringify({
        httpStatus: response.status,
        contentType,
        byteLength: imageBytes.byteLength,
        bytesWritten,
        name: tempFile.name,
        nativePath: tempFile.nativePath,
        url: tempFile.url,
        isFile: tempFile.isFile,
      })}`)
      return tempFile;
    } catch (e) {
      console.error(`[EasySD] Result HTTP import failed: ${JSON.stringify({
        resultFileName: fileNameWithoutPath,
        resultUrl,
        tempFolderNativePath: tempFolder.nativePath,
        tempFileName,
        errorName: e.name,
        errorMessage: e.message,
        errorStack: e.stack,
      })}`)
      throw e;
    }
  }

  saveLayerAsImage = async (layer, fileNameWithoutExtension, fileType) => {
    await this.activateLayer(layer._id)
    const oldLayerName = layer.name
    const shouldRenameLayer = oldLayerName !== fileNameWithoutExtension;
    if (shouldRenameLayer) {
      await this.renameLayer(layer._id, fileNameWithoutExtension)
    }

    const exportFolder = await this.getExportFolder()
    const exportFolderPath = exportFolder.nativePath;
    const exportFileName = `${fileNameWithoutExtension}.${fileType}`
    const exportFilePath = `${exportFolderPath}/${exportFileName}`
    const quality = fileType === "png" ? 32 : 80
    try {
      const descriptor = {
        _obj: 'exportSelectionAsFileTypePressed',
        _target: {_ref: 'layer', _enum: 'ordinal', _value: 'targetEnum'},
        fileType,
        quality,
        metadata: 0,
        destFolder: exportFolderPath,
        sRGB: true,
        openWindow: false,
        _options: {dialogOptions: 'dontDisplay'}
      }
      console.log(`[EasySD] Export request: ${JSON.stringify({
        activeDocumentId: app.activeDocument?._id ?? null,
        layerId: layer._id,
        layerName: layer.name,
        layerKind: layer.kind,
        layerVisible: layer.visible,
        layerBounds: this.getLayerBounds(layer),
        targetExportPath: exportFilePath,
        descriptor,
      })}`)
      await executeAsModal(async () => {
        const result = await batchPlay(
          [
            descriptor
          ],
          {
            modalBehavior: 'execute'
          }
        )
        console.log(`[EasySD] Export batchPlay result: ${JSON.stringify(result)}`)
      })
      let exportedFile = null
      let elapsedMs = 0
      const startedAt = Date.now()
      while (Date.now() - startedAt <= 10000) {
        try {
          exportedFile = await exportFolder.getEntry(exportFileName)
          if (exportedFile?.isFile) {
            elapsedMs = Date.now() - startedAt
            break
          }
        } catch (e) {
        }
        await new Promise(resolve => setTimeout(resolve, 250))
      }
      if (!exportedFile?.isFile) {
        const folderEntries = await exportFolder.getEntries()
        console.error(`[EasySD] Export file missing: ${JSON.stringify({
          targetExportPath: exportFilePath,
          folderEntries: folderEntries.map(entry => `${entry.isFile ? 'file' : 'folder'}:${entry.name}`),
        })}`)
        throw new Error(`Exported file was not created: ${exportFilePath}`)
      }
      console.log(`[EasySD] Export file created after ${elapsedMs}ms: ${exportFilePath}`)
      return exportFilePath;
    } catch (e) {
      console.error("Failed to export image", e)
      throw new UiError(`Cannot export layer "${oldLayerName}" as an image. ${e.message}`)
    } finally {
      // Rename layer to the original name but give Photoshop some time to save the file
      await new Promise(resolve => setTimeout(resolve, 3000))
      if (shouldRenameLayer) {
        await this.renameLayer(layer._id, oldLayerName)
      }
    }
  }

  saveLayerOrBackgroundAsImage = async (layer, fileNameWithoutExtension, fileType) => {
    console.log(`[EasySD] Source export start: ${JSON.stringify({layerId: layer?._id, layerName: layer?.name, isBackground: this.isBackgroundLayer(layer?._id)})}`)
    if (!this.isBackgroundLayer(layer._id)) {
      return this.saveLayerAsImage(layer, fileNameWithoutExtension, fileType)
    }

    const layerCopyId = await this.duplicateLayer(layer._id, fileNameWithoutExtension)
    console.log(`[EasySD] Background source compatibility copy created: ${JSON.stringify({originalLayerId: layer._id, copyLayerId: layerCopyId})}`)
    try {
      const layerCopy = this.getLayerById(layerCopyId)
      console.log(`[EasySD] Background source export uses copy: ${JSON.stringify({copyLayerId: layerCopy._id, copyBounds: this.getLayerBounds(layerCopy)})}`)
      const exportedPath = await this.saveLayerAsImage(layerCopy, fileNameWithoutExtension, fileType)
      console.log(`[EasySD] Background source export succeeded: ${JSON.stringify({copyLayerId: layerCopy._id, exportedPath})}`)
      return exportedPath
    } catch (e) {
      console.error("Failed to export background source image", {originalLayerId: layer._id, copyLayerId: layerCopyId, error: describeThrownValue(e)})
      throw e
    } finally {
      // Rename layer to the original name but give Photoshop some time to save the file
      await new Promise(resolve => setTimeout(resolve, 3000))
      try {
        await this.deleteLayer(layerCopyId)
        console.log(`[EasySD] Background source compatibility copy cleaned up: ${layerCopyId}`)
      } catch (cleanupError) {
        console.error("Failed to clean up background source compatibility copy", {copyLayerId: layerCopyId, error: describeThrownValue(cleanupError)})
      }
    }
  }

  openImageAsDocument = async (fileNameWithoutPath) => {
    const imageFileEntry = await this.getImportFile(fileNameWithoutPath);
    const sourceDocumentId = app.activeDocument?._id ?? null;
    console.log(`[EasySD] app.open about to run: ${JSON.stringify({
      name: imageFileEntry.name,
      nativePath: imageFileEntry.nativePath,
      url: imageFileEntry.url,
      isFile: imageFileEntry.isFile,
    })}`)
    if (!imageFileEntry.isFile) {
      throw new UiError(`Generated result is not a file: ${imageFileEntry.nativePath}`)
    }
    await executeAsModal(async () => {
      try {
        await app.open(imageFileEntry)
        console.log(`[EasySD] app.open succeeded: ${JSON.stringify({fileNameWithoutPath, sourceDocumentId, openedDocumentId: app.activeDocument?._id ?? null, keptOpen: true})}`)
      } catch (e) {
        console.error(`[EasySD] Could not open generated image: ${JSON.stringify({
          fileName: fileNameWithoutPath,
          nativePath: imageFileEntry.nativePath,
          url: imageFileEntry.url,
          errorName: e.name,
          errorMessage: e.message,
          errorStack: e.stack,
        })}`)
        throw new UiError(`Could not open generated image ${fileNameWithoutPath}: ${e.message}`)
      }
    })
    return imageFileEntry;
  }

  openResultAsNewDocument = async (fileNameWithoutPath) => {
    const sourceDocumentId = app.activeDocument?._id ?? null;
    console.log(`[EasySD] New Document placement received: ${JSON.stringify({fileNameWithoutPath, sourceDocumentId})}`);
    const importedFile = await this.getImportFile(fileNameWithoutPath);
    console.log(`[EasySD] New Document temp file created: ${JSON.stringify({name: importedFile.name, nativePath: importedFile.nativePath, url: importedFile.url})}`);
    try {
      console.log(`[EasySD] New Document app.open start: ${JSON.stringify({fileNameWithoutPath, nativePath: importedFile.nativePath})}`);
      const openResult = await executeAsModal(async () => app.open(importedFile));
      const openedDocumentId = app.activeDocument?._id ?? null;
      console.log(`[EasySD] New Document app.open result: ${JSON.stringify({openResult, openedDocumentId, duplicateToSource: false, closed: false, activeDocumentId: openedDocumentId})}`);
      console.log(`[EasySD] New Document temp cleanup skipped intentionally after successful open: ${importedFile.nativePath}`);
      return app.activeDocument;
    } catch (e) {
      console.error(`[EasySD] New Document open failed: ${JSON.stringify({fileNameWithoutPath, sourceDocumentId, errorName: e.name, errorMessage: e.message, errorStack: e.stack})}`);
      throw e;
    }
  }

  openImageAsLayerInDocument = async (documentId, newLayerName, fileNameWithoutPath) => {
    const existingDocumentIds = app.documents.map(doc => doc._id)
    const sourceDocument = app.documents.find(doc => doc._id === documentId)

    // Open the image as a document
    const importedFile = await this.openImageAsDocument(fileNameWithoutPath)

    try {
      // Find the new document. The existing cross-document duplication path is
      // intentionally preserved for compatibility with current Photoshop.
      const newDocument = app.documents.filter(doc => !existingDocumentIds.includes(doc._id))[0]
      if (!newDocument) {
        throw new UiError(`Could not find the temporary result document for ${fileNameWithoutPath}`)
      }
      await executeAsModal(() => {
        const sourceLayer = newDocument.layers[0]
        if (!sourceLayer || sourceLayer.kind === "group") {
          throw new UiError(`Temporary result layer is not a pixel/art layer for ${fileNameWithoutPath}`)
        }
        return sourceLayer.duplicate(sourceDocument).then(duplicatedLayer => {
          duplicatedLayer.name = newLayerName
          console.log(`[EasySD] Standalone result layer duplicated into target document: ${JSON.stringify({
            fileNameWithoutPath,
            sourceLayerId: sourceLayer._id,
            duplicatedLayerId: duplicatedLayer._id,
            duplicatedLayerKind: duplicatedLayer.kind,
          })}`)
          return newDocument.closeWithoutSaving()
        })
      })
    } catch (e) {
      throw e
    } finally {
      // Photoshop may retain the opened temp file after app.open(). Avoid
      // deleting it here because UXP can report a permission error.
      console.log(`[EasySD] New Layer temp file cleanup skipped after app.open(): ${importedFile.nativePath}`)
    }
  }

  getDocumentPixelSize = (document) => {
    const readDimension = (dimension) => {
      if (typeof dimension === "number") return dimension
      if (typeof dimension?._value === "number") return dimension._value
      if (typeof dimension?.value === "number") return dimension.value
      return null
    }
    return {
      width: readDimension(document?.width),
      height: readDimension(document?.height),
    }
  }

  placeResultOverSelectedArea = async (documentId, newLayerName, fileNameWithoutPath, requestId, prompt) => {
    const existingDocumentIds = app.documents.map(doc => doc._id)
    const sourceDocument = app.documents.find(doc => doc._id === documentId)
    if (!sourceDocument) {
      throw new UiError(`Could not find target document ${documentId}`)
    }

    const sourceSize = this.getDocumentPixelSize(sourceDocument)
    const importedFile = await this.openImageAsDocument(fileNameWithoutPath)
    let resultDocument = null
    let resultLayerDuplicated = false
    let duplicatedResultLayer = null

    try {
      resultDocument = app.documents.find(doc => !existingDocumentIds.includes(doc._id))
      if (!resultDocument) {
        throw new UiError(`Could not find the temporary result document for ${fileNameWithoutPath}`)
      }

      const resultSize = this.getDocumentPixelSize(resultDocument)
      console.log(`[EasySD] Replace Selected Area geometry: ${JSON.stringify({
        sourceDocumentId: documentId,
        sourceSize,
        resultDocumentId: resultDocument._id,
        resultSize,
        fileNameWithoutPath,
      })}`)
      if (
        sourceSize.width === null || sourceSize.height === null ||
        resultSize.width === null || resultSize.height === null
      ) {
        throw new UiError("Cannot verify generated result dimensions for Replace Selected Area")
      }
      if (sourceSize.width !== resultSize.width || sourceSize.height !== resultSize.height) {
        throw new UiError(
          `Generated result size ${resultSize.width}x${resultSize.height} does not match target document ${sourceSize.width}x${sourceSize.height}`
        )
      }

      await executeAsModal(async () => {
        const resultLayer = resultDocument.layers[0]
        if (!resultLayer) throw new UiError("Could not find imported result layer")
        resultLayer.name = newLayerName
        duplicatedResultLayer = await resultLayer.duplicate(sourceDocument)
        resultLayerDuplicated = true
        await resultDocument.closeWithoutSaving()
      })
      resultDocument = null

      await this.placeResultInBatchGroup(documentId, requestId, prompt, newLayerName, duplicatedResultLayer)
      console.log(`[EasySD] Replace Selected Area completed: ${JSON.stringify({
        sourceDocumentId: documentId,
        resultLayerDuplicated,
        resultDocumentClosed: true,
        nonDestructive: true,
      })}`)
    } catch (e) {
      console.error(`[EasySD] Replace Selected Area failed: ${JSON.stringify({
        fileNameWithoutPath,
        sourceDocumentId: documentId,
        resultLayerDuplicated,
        error: describeThrownValue(e),
      })}`)
      if (duplicatedResultLayer) {
        try {
          await executeAsModal(async () => duplicatedResultLayer.delete())
          console.log(`[EasySD] Replace Selected Area duplicated layer cleaned up after failure`)
        } catch (cleanupError) {
          console.error(`[EasySD] Replace Selected Area duplicated layer cleanup failed: ${JSON.stringify(describeThrownValue(cleanupError))}`)
        }
      }
      throw e
    } finally {
      if (resultDocument) {
        try {
          await executeAsModal(async () => resultDocument.closeWithoutSaving())
          console.log(`[EasySD] Replace Selected Area temporary document cleaned up: ${resultDocument._id}`)
        } catch (cleanupError) {
          console.error(`[EasySD] Replace Selected Area temporary document cleanup failed: ${JSON.stringify(describeThrownValue(cleanupError))}`)
        }
      }
      // Photoshop may retain the opened temp file after app.open(). Deleting it
      // here causes a FileSystemProvider permission error, so UXP temp storage
      // owns eventual cleanup for Replace Selected Area.
      console.log(`[EasySD] Replace Selected Area temp file cleanup skipped after app.open(): ${importedFile.nativePath}`)
    }
  }

  placeResultInBatchGroup = async (documentId, requestId, prompt, resultLayerName, resultLayerOverride = null) => {
    const document = app.documents.find(doc => doc._id === documentId);
    if (!document) throw new UiError(`Could not find result document ${documentId}`);
    await executeAsModal(async () => {
      const groupName = `EasySD - ${prompt.replace(RESULT_GROUP_NAME_REGEX, " ").trim().slice(0, 24)} - ${requestId.slice(0, 8)}`;
      let group = document.layers.find(layer => layer.name === groupName && layer.kind === "group");
      let groupCreated = false;
      try {
        if (!group) {
          group = await document.createLayerGroup({name: groupName});
          groupCreated = true;
          console.log(`[EasySD] Created result batch group: ${JSON.stringify({groupName, requestId, groupId: group._id})}`);
        }
        const resultLayer = resultLayerOverride || document.activeLayers[0];
        if (!resultLayer) throw new UiError("Could not find imported result layer");
        resultLayer.name = resultLayerName;
        const placeInside = ElementPlacement?.PLACEINSIDE;
        console.log(`[EasySD] Result group reparent diagnostics: ${JSON.stringify({
          requestId,
          groupId: group._id,
          layerId: resultLayer._id,
          layerMoveAvailable: typeof resultLayer.move === "function",
          placeInside,
          elementPlacementKeys: ElementPlacement ? Object.keys(ElementPlacement) : [],
        })}`);
        if (typeof resultLayer.move !== "function" || placeInside === undefined) {
          throw new UiError("Photoshop does not expose the layer move-to-group operation");
        }
        await resultLayer.move(group, placeInside);
        const parentId = resultLayer.parent?._id ?? null;
        if (parentId !== group._id) {
          throw new UiError(`Result layer ${resultLayer._id} was not placed inside result group ${group._id}`);
        }
        console.log(`[EasySD] Result placed in batch group: ${JSON.stringify({requestId, groupId: group._id, layerId: resultLayer._id, resultLayerName})}`);
      } catch (e) {
        if (groupCreated && group) {
          try {
            const groupIsEmpty = !group.layers || group.layers.length === 0;
            if (groupIsEmpty) {
              group.delete();
              console.log(`[EasySD] Empty result group cleaned up after placement failure: ${group._id}`);
            }
          } catch (cleanupError) {
            console.error(`[EasySD] Empty result group cleanup failed: ${JSON.stringify(describeThrownValue(cleanupError))}`);
          }
        }
        throw e;
      }
    });
  }

  openImageAsLayerInActiveDocument = async (newLayerName, fileNameWithoutPath) => {
    const activeDocument = this.getActiveDocument()
    return await this.openImageAsLayerInDocument(activeDocument._id, newLayerName, fileNameWithoutPath)
  }

}

export const photoshopApp = new PhotoshopApp();
