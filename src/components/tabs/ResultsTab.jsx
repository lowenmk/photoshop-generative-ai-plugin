import "./ResultsTab.css";
import React, {useContext} from "react";
import {photoshopApp} from "../../photoshop/PhotoshopApp";
import {Space1} from "../common/Spaces";
import {AlertContext} from "../../contexts/AlertContext";
import {localServerApi} from "../../api/localServerApi";

const {STATIC_FILES_URL} = require("../../utils/Constants");
const {LineArrowDownIcon, LineArrowRightIcon} = require("../common/Icons");
const {settingsStorage} = require("../../utils/SettingsStorage");
const {trueOrUndefined} = require("../../utils/utils");

const LAYER_NAME_MAX_PROMPT_CHARS = 20
const LAYER_ALERT_CHARS = 10
const NON_ALPHANUMERIC_REGEX = /[^a-zA-Z0-9\-_]+/g
const PLACEMENT_MODES = {NEW_LAYER: "newLayer", NEW_DOCUMENT: "newDocument"}

const ResultItem = (
  {
    prompt,
    imageFileName,
    thumbnailFileName,
    seed,
    onSeedChange,
    cfgScale,
    onCfgScaleChange,
    denoisingStrength,
    onDenoisingStrengthChange,
    requestId,
    resultIndex,
    placementMode,
    onPlacementModeChange,
    onNavigate,
    canPrevious,
    canNext,
    onDelete,
    deletePending,
    isSelected,
    onSelect,
  }
) => {
  const alertContext = useContext(AlertContext);
  const effectivePlacementMode = placementMode || PLACEMENT_MODES.NEW_LAYER;
  console.log("[EasySD ResultItem] render", {resultIndex, imageFileName, thumbnailFileName, requestId, isSelected});

  const displayCfgScale = Math.round(cfgScale * 100) / 100
  const displayDenoisingStrength = denoisingStrength ? Math.round(denoisingStrength * 100) / 100 : 0

  const onImageToLayerClick = async () => {
    try {
      const firstPromptChars = prompt.replace(NON_ALPHANUMERIC_REGEX, " ").slice(0, LAYER_NAME_MAX_PROMPT_CHARS)
      let layerName = `Result ${resultIndex + 1} - Seed ${seed}`
      if (displayDenoisingStrength) {
        layerName += `. DS ${displayDenoisingStrength}`
      }
      if (effectivePlacementMode === PLACEMENT_MODES.NEW_DOCUMENT) {
        console.log(`[EasySD] Result placement selected: ${JSON.stringify({placementMode: effectivePlacementMode, imageFileName})}`)
        await photoshopApp.openResultAsNewDocument(imageFileName)
      } else {
        const topVisibleLayerId = photoshopApp.getTopVisibleLayerId()
        if (topVisibleLayerId !== null) await photoshopApp.activateLayer(topVisibleLayerId)
        await photoshopApp.openImageAsLayerInActiveDocument(layerName, imageFileName)
        await photoshopApp.placeResultInBatchGroup(
          photoshopApp.getActiveDocument()._id,
          requestId,
          prompt,
          layerName,
        )
      }
    } catch (e) {
      alertContext.setError(<>{e.message}</>)
    }
  }

  const onCopySeedClick = async () => {
    onSeedChange(seed)
    alertContext.setSuccess(<>Set seed to {seed}</>)
  }

  const onCopyCfgScaleClick = async () => {
    onCfgScaleChange(cfgScale)
    alertContext.setSuccess(<>Set CFG scale to {cfgScale}</>)
  }

  const onCopyDenoisingStrengthClick = async () => {
    onDenoisingStrengthChange(denoisingStrength)
    alertContext.setSuccess(<>Set Denoising Strength to {denoisingStrength}</>)
  }

  return (
    <>
      <div className="container flexColumn resultItem">
          <div>RESULT ITEM {resultIndex}</div>
          <div>FILE: {thumbnailFileName}</div>
          <img src={`${STATIC_FILES_URL}/${thumbnailFileName}`} className={`resultThumbnailImage ${isSelected ? "resultThumbnailSelected" : ""}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSelect(); }}/>
          <div className="container flexRow justifyContentCenter">
            <sp-picker value={effectivePlacementMode}>
              <sp-menu slot="options" onClick={(e) => { console.log(`[EasySD] Placement selector changed: ${e.target.value}`); onPlacementModeChange(imageFileName, e.target.value); }}>
                <sp-menu-item value={PLACEMENT_MODES.NEW_LAYER} selected={trueOrUndefined(effectivePlacementMode === PLACEMENT_MODES.NEW_LAYER)}>New Layer</sp-menu-item>
                <sp-menu-item value={PLACEMENT_MODES.NEW_DOCUMENT} selected={trueOrUndefined(effectivePlacementMode === PLACEMENT_MODES.NEW_DOCUMENT)}>Open as Image</sp-menu-item>
              </sp-menu>
            </sp-picker>
            <sp-action-button
              class="resultControlsButton"
              variant="secondary"
              onClick={onImageToLayerClick}
            >{effectivePlacementMode === PLACEMENT_MODES.NEW_DOCUMENT ? "Open Image" : "To Layer"}
            </sp-action-button>
          </div>
          <div className="container flexRow justifyContentCenter">
            <sp-action-button
              class="resultControlsButton"
              variant="secondary"
              onClick={onCopySeedClick}
            >Copy Seed
            </sp-action-button>
          </div>
          <div className="container flexRow justifyContentCenter">
            <sp-action-button
              class="resultControlsButton"
              variant="secondary"
              onClick={onCopyCfgScaleClick}
            >Copy CFG {displayCfgScale}
            </sp-action-button>
            {!!denoisingStrength ? (
              <sp-action-button
                class="resultControlsButton"
                variant="secondary"
                onClick={onCopyDenoisingStrengthClick}
              >Copy DS {displayDenoisingStrength}
              </sp-action-button>
            ) : null}
          </div>
          {deletePending ? (
            <div className="container flexRow resultDeleteInline">
              <sp-action-button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(e, imageFileName, true); }}>Confirm</sp-action-button>
              <sp-action-button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(e, imageFileName, false, true); }}>Cancel</sp-action-button>
            </div>
          ) : (
            <sp-action-button class="resultControlsButton" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(e, imageFileName); }}>Delete Result</sp-action-button>
          )}
      </div>
    </>
  )
}

const ResultGroup = (
  {
    prompt,
    negativePrompt,
    groupItems,
    isCollapsed,
    onIsCollapsedChange,
    onSeedChange,
    onCfgScaleChange,
    onDenoisingStrengthChange,
    requestId,
    placementByResult,
    onPlacementModeChange,
    selectedIndex,
    onNavigate,
    onDeleteBatch,
    onDelete,
    pendingBatchDelete,
    pendingResultDelete,
    onSelect,
  }
) => {
  const promptAndNegativePrompt = prompt + (negativePrompt ? ` / ${negativePrompt}` : "");
  const orderedItems = Array.isArray(groupItems) ? groupItems : Array.from(groupItems || []);
  return (
    <>
      <div className="container flexColumn">
        <div className="container flexRow advancedOptionsLabel" onClick={onIsCollapsedChange}>
          {isCollapsed ? (
            <span
              className="advancedOptionsIcon"
              slot="icon"
            ><LineArrowRightIcon /></span>
          ) : (
            <span
              className="advancedOptionsIcon"
              slot="icon"
            ><LineArrowDownIcon /></span>
          )}
          <div className="resultsPrompt">{promptAndNegativePrompt}</div>
          <div className="container flexRow resultBatchNavigation" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
            <sp-action-button disabled={selectedIndex <= 0} onClick={() => onNavigate(-1)}>Previous</sp-action-button>
            <sp-action-button disabled={selectedIndex >= orderedItems.length - 1} onClick={() => onNavigate(1)}>Next</sp-action-button>
          </div>
          {pendingBatchDelete ? (
            <div className="container flexRow resultDeleteInline" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
              <sp-action-button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDeleteBatch(e, requestId, true); }}>Confirm</sp-action-button>
              <sp-action-button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDeleteBatch(e, requestId, false, true); }}>Cancel</sp-action-button>
            </div>
          ) : (
            <sp-action-button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDeleteBatch(e, requestId); }}>Delete Batch</sp-action-button>
          )}
        </div>
        <sp-divider size="medium"></sp-divider>
        <Space1 />
        {!isCollapsed ? (
          <>
            <div className="resultsGrid">
              {orderedItems.map((result, resultIndex) => (
                <React.Fragment key={result.image_file_name}>
                  <div>PARENT ITEM {resultIndex}</div>
                  <ResultItem
                  prompt={prompt}
                  imageFileName={result.image_file_name}
                  thumbnailFileName={result.thumbnail_file_name}
                  seed={result.seed}
                  onSeedChange={onSeedChange}
                  cfgScale={result.cfg_scale}
                  onCfgScaleChange={onCfgScaleChange}
                  denoisingStrength={result.denoising_strength}
                  onDenoisingStrengthChange={onDenoisingStrengthChange}
                  requestId={requestId}
                  resultIndex={resultIndex}
                  placementMode={placementByResult[result.image_file_name] || PLACEMENT_MODES.NEW_LAYER}
                  onPlacementModeChange={onPlacementModeChange}
                  onDelete={onDelete}
                  deletePending={pendingResultDelete === result.image_file_name}
                  isSelected={selectedIndex === resultIndex}
                  onSelect={() => onSelect(resultIndex)}
                  />
                </React.Fragment>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </>
  )
}

export class ResultsTab extends React.Component {

  constructor(props) {
    super(props);

    const requestIds = new Set (this.props.resultGroups.map(resultGroup => resultGroup.request_id))
    const storedCollapsedResultsMap = settingsStorage.getResultsSettings().collapsedResultsMap || {}
    const collapsedResultsMap = Object.fromEntries(Object.entries(storedCollapsedResultsMap).map(([requestId, value]) => [
      requestId,
      typeof value === "string" ? value.toLowerCase() === "true" : Boolean(value),
    ]))

    Object.keys(collapsedResultsMap).forEach((requestId) => {
      // Only load for requests which results are available to prevent unbounded growth of the map
      if (!requestIds.has(requestId)) {
        delete collapsedResultsMap[requestId];
      }
    });

    this.state = {
      collapsedResultsMap,
      placementByResult: {},
      selectedIndex: {},
    }
  }

  onPlacementModeChange = (imageFileName, placementMode) => this.setState({
    placementByResult: {...this.state.placementByResult, [imageFileName]: placementMode},
  });
  refreshResults = async () => {
    const resultGroups = await localServerApi.getAllResults();
    const selectedIndex = {...this.state.selectedIndex};
    resultGroups.forEach(group => {
      selectedIndex[group.request_id] = Math.min(selectedIndex[group.request_id] ?? 0, Math.max(0, group.group_items.length - 1));
    });
    this.setState({selectedIndex});
    this.props.onResults(resultGroups);
  };
  onDeleteResult = async (event, imageFileName, confirmed = false, cancel = false) => {
    console.log(`[EasySD] Delete Result clicked: ${imageFileName}`);
    if (cancel) return this.cancelDelete();
    if (confirmed) return this.confirmDelete();
    this.setState({deleteConfirmation: {type: "result", imageFileName}});
  }
  onDeleteBatch = async (event, requestId, confirmed = false, cancel = false) => {
    console.log(`[EasySD] Delete Batch clicked: ${requestId}`);
    if (cancel) return this.cancelDelete();
    if (confirmed) return this.confirmDelete();
    this.setState({deleteConfirmation: {type: "batch", requestId}});
  }
  cancelDelete = () => this.setState({deleteConfirmation: null});
  confirmDelete = async () => {
    const confirmation = this.state.deleteConfirmation;
    this.setState({deleteConfirmation: null});
    try {
      if (!confirmation) return;
      if (confirmation.type === "result") {
        console.log(`[EasySD] Delete Result confirmation result: true`);
        console.log(`[EasySD] Delete Result API start: ${confirmation.imageFileName}`);
        const response = await localServerApi.deleteResult(confirmation.imageFileName);
        console.log(`[EasySD] Delete Result API response: ${JSON.stringify(response)}`);
      } else {
        console.log(`[EasySD] Delete Batch confirmation result: true`);
        console.log(`[EasySD] Delete Batch API start: ${confirmation.requestId}`);
        const response = await localServerApi.deleteResultBatch(confirmation.requestId);
        console.log(`[EasySD] Delete Batch API response: ${JSON.stringify(response)}`);
      }
      console.log("[EasySD] Delete refresh start");
      await this.refreshResults();
      console.log("[EasySD] Delete refresh complete");
    } catch (e) {
      console.error("[EasySD] Delete failed", e);
      this.setState({deleteError: e.message || String(e)});
    }
  }
  onNavigate = (requestId, delta, count) => this.setState({selectedIndex: {...this.state.selectedIndex, [requestId]: Math.max(0, Math.min(count - 1, (this.state.selectedIndex[requestId] ?? 0) + delta))}});
  onSelect = (requestId, index) => this.setState({selectedIndex: {...this.state.selectedIndex, [requestId]: index}});

  onIsCollapsedChange = (requestId, isCollapsed) => {
    try {
      const newCollapsedResultsMap = {
        ...this.state.collapsedResultsMap,
        [requestId]: isCollapsed,
      };
      this.setState({
        collapsedResultsMap: newCollapsedResultsMap,
      })
      settingsStorage.saveResultsSettingsSync({
        collapsedResultsMap: newCollapsedResultsMap,
      })
    } catch (e) {
      console.error(e)
    }
  }

  render() {
    let {
      resultGroups,
      onSeedChange,
      onCfgScaleChange,
      onDenoisingStrengthChange,
    } = this.props;
    let {collapsedResultsMap} = this.state;

    if (resultGroups.length <= 0) {
          return (
        <div className="container flexRow justifyContentCenter">
          <sp-body size="S">No results to show, please use Dream tab first</sp-body>
        </div>
      )
    }
    return (
      <>
        {this.state.deleteError ? <sp-body>{this.state.deleteError}</sp-body> : null}
        <div className="container flexColumn">
          {resultGroups.map(resultGroup => {
            const storedValue = collapsedResultsMap[resultGroup.request_id];
            const isCollapsed = storedValue === undefined ? false : Boolean(storedValue);
            return (
              <ResultGroup
                key={resultGroup.request_id}
                prompt={resultGroup.prompt}
                negativePrompt={resultGroup.negative_prompt}
                groupItems={resultGroup.group_items}
                isCollapsed={isCollapsed}
                onIsCollapsedChange={() => this.onIsCollapsedChange(resultGroup.request_id, !isCollapsed)}
                onSeedChange={onSeedChange}
                onCfgScaleChange={onCfgScaleChange}
                onDenoisingStrengthChange={onDenoisingStrengthChange}
                requestId={resultGroup.request_id}
                placementByResult={this.state.placementByResult}
                onPlacementModeChange={this.onPlacementModeChange}
                selectedIndex={this.state.selectedIndex[resultGroup.request_id] ?? 0}
                onNavigate={(delta) => this.onNavigate(resultGroup.request_id, delta, resultGroup.group_items.length)}
                onDeleteBatch={this.onDeleteBatch}
                onDelete={this.onDeleteResult}
                pendingBatchDelete={this.state.deleteConfirmation?.type === "batch" && this.state.deleteConfirmation.requestId === resultGroup.request_id}
                pendingResultDelete={this.state.deleteConfirmation?.type === "result" ? this.state.deleteConfirmation.imageFileName : null}
                selectedIndex={this.state.selectedIndex[resultGroup.request_id] ?? 0}
                onSelect={(index) => this.onSelect(resultGroup.request_id, index)}
              />
            );
          })}
        </div>
      </>
    );
  }
}
