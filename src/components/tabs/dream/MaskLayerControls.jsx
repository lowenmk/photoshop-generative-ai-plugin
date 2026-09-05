import React, {useContext} from "react";
import {ERASER_TOOL, PAINTBRUSH_TOOL} from "../../../utils/Constants";
import {AlertContext} from "../../../contexts/AlertContext";

const {InferenceType, MaskSource} = require("../../../utils/Constants");
const {Space1, Space2} = require("../../common/Spaces");
const {photoshopApp} = require("../../../photoshop/PhotoshopApp");
const {BrushToolIcon, EraserToolIcon} = require("../../common/Icons");

export const MaskLayerControls = ({
  inferenceType,
  maskSource,
  selectionInvert,
  selectionFeather,
  selectionExpand,
  onMaskSourceChange,
  onSelectionInvertChange,
  onSelectionFeatherChange,
  onSelectionExpandChange,
}) => {
  const alertContext = useContext(AlertContext);

  const selectMaskBrushTool = async () => {
    await photoshopApp.setForegroundColor(0, 255, 255)
    await photoshopApp.pickTool(PAINTBRUSH_TOOL)

    // If the user picks the mask brush tool, they want to draw on the mask
    // Hence, let's check if the currently active layer is a mask and if not, activate the most recent visible mask
    // It's a little feature that might be handy
    if (photoshopApp.isMaskLayer(photoshopApp.getActiveLayer())) {
      return
    }

    const maskLayer = photoshopApp.getLatestVisibleMaskLayer();
    if (maskLayer) {
      await photoshopApp.activateLayer(maskLayer._id);
    }
  }

  const selectMaskEraserTool = async () => {
    await photoshopApp.pickTool(ERASER_TOOL);
  }

  const newMaskLayer = async () => {
    const layerName = await photoshopApp.createMaskLayer();
    alertContext.setSuccess(<>Added new layer "{layerName}"</>);
    await selectMaskBrushTool();
  }

  const clearMaskLayers = async () => {
    await photoshopApp.clearMaskLayers()
    alertContext.setSuccess(<>Removed all mask layers</>);
  }

  return (
    <>
      {inferenceType === InferenceType.INPAINT ? (
        <>
          <Space2 />
          <div className="container flexRow">
            <sp-picker class="modelDropdown">
              <sp-label slot="label">Mask source</sp-label>
              <sp-menu slot="options" onClick={(e) => onMaskSourceChange(e.target.value)}>
                <sp-menu-item value={MaskSource.CURRENT_SELECTION} selected={maskSource === MaskSource.CURRENT_SELECTION}>Current Selection</sp-menu-item>
                <sp-menu-item value={MaskSource.MASK_LAYER} selected={maskSource === MaskSource.MASK_LAYER}>Mask Layer</sp-menu-item>
              </sp-menu>
            </sp-picker>
          </div>
          {maskSource === MaskSource.CURRENT_SELECTION ? (
            <div className="container flexColumn">
              <sp-checkbox checked={selectionInvert} onChange={(e) => onSelectionInvertChange(Boolean(e.target.checked))}>Invert mask</sp-checkbox>
              <sp-label>Feather mask (px)</sp-label>
              <sp-textfield value={selectionFeather} onInput={(e) => onSelectionFeatherChange(e.target.value)} />
              <sp-label>Expand / contract (px)</sp-label>
              <sp-textfield value={selectionExpand} onInput={(e) => onSelectionExpandChange(e.target.value)} />
              <sp-body size="S">Positive expands; negative contracts the selection.</sp-body>
            </div>
          ) : null}
          <div className="container flexRow">
            <sp-action-button
              class="maskLayerButton"
              variant="primary"
              onClick={newMaskLayer}
            >New Mask Layer</sp-action-button>
            <Space1 />
            <sp-action-button
              class="maskLayerButton"
              variant="primary"
              onClick={clearMaskLayers}
            >Clear Mask Layers</sp-action-button>
            <Space1 />
            <sp-action-button
              class="toolButton"
              title="Pick Brush tool"
              onClick={selectMaskBrushTool}
            >
              <span slot="icon"><BrushToolIcon /></span>
            </sp-action-button>
            <sp-action-button
              class="toolButton"
              title="Pick Eraser tool"
              onClick={selectMaskEraserTool}
            >
              <span slot="icon"><EraserToolIcon /></span>
            </sp-action-button>
          </div>
        </>
      ) : null}
    </>
  );
}
