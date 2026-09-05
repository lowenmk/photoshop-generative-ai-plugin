import "./DreamTab.css";
const {Space2} = require("../common/Spaces");
const {DisplayAsMainAlertError} = require("../../exceptions/Exceptions");
const {useContext} = require("react");
const {ModalContext} = require("../../contexts/ModalContext");
const {AlertContext} = require("../../contexts/AlertContext");
const React = require('react');
const {ModelsDropdown} = require("./dream/ModelsDropdown");
const {SeedCheckboxAndInput} = require("./dream/SeedCheckboxAndInput");
const {CfgScaleCheckboxAndInput} = require("./dream/CfgScaleCheckboxAndInput");
const {DenoisingStrengthCheckboxAndInput} = require("./dream/DenoisingStrengthCheckboxAndInput");
const {AdvancedOptions} = require("./dream/AdvancedOptions");
const {InstructionsBanner} = require("./dream/InstructionsBanner");
const {settingsStorage} = require("../../utils/SettingsStorage");
const {InferenceTypeSelection} = require("./dream/InferenceTypeSelection");
const {SourceLayerControls} = require("./dream/SourceLayerControls");
const {MaskLayerControls} = require("./dream/MaskLayerControls");
const {PromptControls} = require("./dream/PromptControls");
const {trueOrUndefined} = require("../../utils/utils");
const {InferenceType, MaskSource, STATIC_FILES_URL} = require("../../utils/Constants");
const {getRandomRequestId} = require("../../utils/utils");
const {photoshopApp} = require("../../photoshop/PhotoshopApp");
const {localServerApi} = require("../../api/localServerApi");

const getSafeErrorMessage = (error) => {
  if (error?.message) {
    return error.message;
  }
  if (typeof error?.toString === "function") {
    const stringValue = error.toString();
    if (stringValue && stringValue !== "[object Object]") {
      return stringValue;
    }
  }
  try {
    const json = JSON.stringify(error);
    if (json && json !== "{}") {
      return json;
    }
  } catch (serializationError) {
    console.error("Could not serialize thrown value", serializationError);
  }
  return "Unknown error";
};

const INPAINT_REQUEST_LOG_FIELDS = [
  "document_id", "document_width", "document_height", "selection_area",
  "source_image_path", "source_image_x", "source_image_y",
  "mask_image_path", "mask_image_x", "mask_image_y", "mask_blur",
  "masked_content", "denoising_strength", "seed", "cfg_scale",
  "sampling_method", "sampling_steps", "image_count",
];

const logInpaintRequest = (request, selectionControls) => {
  const requestFields = {};
  for (const field of INPAINT_REQUEST_LOG_FIELDS) {
    requestFields[field] = request[field];
  }
  const scalarTypes = {};
  for (const field of INPAINT_REQUEST_LOG_FIELDS) {
    scalarTypes[field] = typeof request[field];
  }
  for (const field of ["selectionInvert", "selectionFeather", "selectionExpand"]) {
    scalarTypes[field] = typeof selectionControls[field];
  }
  console.log("[EasySD] Outgoing inpaint request", requestFields);
  console.log("[EasySD] Outgoing inpaint scalar types", scalarTypes);
};

const preloadImages = async (imageUrls) => {
  for (let imageUrl of imageUrls) {
    await fetch(imageUrl)
  }
}

class DreamTabInternal extends React.Component {
  constructor(props) {
    super(props);
    const savedOrDefaultSettings = settingsStorage.getDreamSettings()
    this.state = savedOrDefaultSettings;
  }

  componentDidUpdate(prevProps, prevState, snapshot) {
    settingsStorage.saveDreamSettingsBatched(this.state);
  }

  onCancelButtonClick = async () => {
    // This should disable the cancel button. Further calls to onProgress won't enable it again
    // because backed is already aware that the enqueued request is removed
    this.props.onProgress({
      canCancelProgress: false,
    })
    await localServerApi.stopProcessing()
  }

  onDreamButtonClick = async () => {
    const {
      seed,
      cfgScale,
      denoisingStrength,
      onProgress,
      onResults,
      sourceLayer,
      onBeforeDreamButtonClicked,
    } = this.props;
    const {
      prompt,
      negativePrompt,
      imageCount,
      samplingMethod,
      samplingSteps,
      restoreFaces,
      inferenceType,
      maskBlur,
      maskedContent,
      maskSource,
      selectionInvert,
      selectionFeather,
      selectionExpand,
    } = this.state;

    await onBeforeDreamButtonClicked();

    const requestId = getRandomRequestId()
    try {
      // TODO: this seems too convoluted, find a better way
      // Start the progress but don't enable cancellation yet because the server doesn't know about the request
      onProgress({
        progress: 1,
        canCancelProgress: false,
        isProcessing: true,
      })

      const activeDocument = photoshopApp.getActiveDocument()
      let selectionArea = await photoshopApp.getSelectionArea();

      // These options apply to all inference types
      const baseRequest = {
        request_id: requestId,
        document_id: activeDocument._id,
        document_width: activeDocument.width,
        document_height: activeDocument.height,
        prompt: prompt,
        negative_prompt: negativePrompt,
        image_count: imageCount,
        seed: seed,
        cfg_scale: cfgScale,
        sampling_method: samplingMethod,
        sampling_steps: samplingSteps,
        restore_faces: restoreFaces,
        selection_area: selectionArea,
      }

      const img2imgOrInpaintingRequestPart = await this.getImg2ImgOrInpaintingRequestPart(
        activeDocument,
        inferenceType,
        sourceLayer,
        denoisingStrength,
      );
      const inpaintingRequestPart = await this.getInpaintingRequestPart(
        activeDocument,
        inferenceType,
        maskBlur,
        maskedContent,
        maskSource,
        selectionInvert,
        selectionFeather,
        selectionExpand,
      );

      // Give another progress bump after exporting all of the layers
      onProgress({
        progress: 2,
        canCancelProgress: false,
        isProcessing: true,
      })

      const request = {
        ...baseRequest,
        ...img2imgOrInpaintingRequestPart,
        ...inpaintingRequestPart,
      }
      if (inpaintingRequestPart.effective_selection_area) {
        request.selection_area = inpaintingRequestPart.effective_selection_area;
        delete request.effective_selection_area;
      }
      console.log(`[EasySD] Selection area flow: ${JSON.stringify({
        originalSelectionArea: selectionArea,
        effectiveSelectionArea: request.selection_area,
        expand: selectionExpand,
        inferenceType,
      })}`)
      // Enqueue image processing request
      if (inferenceType === InferenceType.TXT_2_IMG) {
        await localServerApi.enqueueTxt2ImgRequest(request)
      } else if (inferenceType === InferenceType.IMG_2_IMG) {
        await localServerApi.enqueueImg2ImgRequest(request)
      } else {
        logInpaintRequest(request, {selectionInvert, selectionFeather, selectionExpand});
        await localServerApi.enqueueInpaintRequest(request)
      }

      // Start checking for progress now that backend is aware of it
      this.startCheckingProgressForRequest().then(() => {})

      // Blocking call to start processing the request. Stopping the progress would unblock this method soon
      await localServerApi.processEnqueuedRequest()

      const resultGroups = await this.fetchResultGroups(requestId)
      onResults(resultGroups, requestId)
    } catch (e) {
      console.log("Error processing images")
      console.error(e);
      console.error("Error processing images details", {
        typeofError: typeof e,
        stringValue: String(e),
        name: e?.name,
        message: e?.message,
        stack: e?.stack,
      });
      const errorMessage = getSafeErrorMessage(e);
      if (e instanceof DisplayAsMainAlertError) {
        this.props.alertContext.setError(<>{errorMessage}</>)
      } else {
        // Show alert because this is a long-running action and I don't expect the user to stare at the screen
        // all the time before it's complete, so in case of an error it's best to be as clear as possible
        photoshopApp.showAlert(`Error generating images: ${errorMessage}`)
      }
    } finally {
      onProgress({
        progress: 100,
        canCancelProgress: false,
        isProcessing: false,
      })
    }
  }

  async getInpaintingRequestPart(activeDocument, inferenceType, maskBlur, maskedContent, maskSource, selectionInvert, selectionFeather, selectionExpand) {
    if (inferenceType !== InferenceType.INPAINT) {
      return {};
    }

    if (maskSource === MaskSource.CURRENT_SELECTION) {
      const selectionMask = await photoshopApp.exportSelectionAsMask({
        invert: selectionInvert,
        feather: Number(selectionFeather) || 0,
        expand: Number(selectionExpand) || 0,
      });
      return {
        mask_blur: maskBlur,
        masked_content: maskedContent,
        ...selectionMask,
        effective_selection_area: Number(selectionExpand) !== 0
          ? selectionMask.effective_selection_area
          : undefined,
      };
    }

    // Existing Mask Layer workflow remains unchanged.
    const maskImageFileName = `doc${activeDocument._id}-mask`
    const maskLayer = photoshopApp.getLatestVisibleMaskLayer();
    const maskImagePath = await photoshopApp.saveLayerAsImage(maskLayer, maskImageFileName, "png");
    const maskArea = photoshopApp.getLayerBounds(maskLayer)
    return {
      mask_blur: maskBlur,
      masked_content: maskedContent,
      mask_image_path: maskImagePath,
      mask_image_x: maskArea.x,
      mask_image_y: maskArea.y,
    };
  }

  getImg2ImgOrInpaintingRequestPart = async (activeDocument, inferenceType, sourceLayer, denoisingStrength) => {
    if (inferenceType !== InferenceType.IMG_2_IMG && inferenceType !== InferenceType.INPAINT) {
      return {};
    }

    // Export the source layer to png. We need transparency in cases of source images occupying only
    // part of the document area
    const sourceLayerId = sourceLayer._id;
    const sourceLayerPhotoshop = photoshopApp.maybeGetLayerById(sourceLayerId);
    if (!sourceLayerPhotoshop) {
      // The source layer is not found, reload
      this.props.onSourceLayerChange(null);
      throw new DisplayAsMainAlertError("Please pick the source layer again!")
    }

    const sourceImageFileName = `doc${activeDocument._id}-layer`
    const sourceImagePath = await photoshopApp.saveLayerOrBackgroundAsImage(sourceLayerPhotoshop, sourceImageFileName, "png");

    // Source layer can also occupy only part of the document, we need to take that into account as well
    const sourceLayerArea = photoshopApp.getLayerBounds(sourceLayerPhotoshop)

    return {
      denoising_strength: denoisingStrength,
      source_image_path: sourceImagePath,
      source_image_x: sourceLayerArea.x,
      source_image_y: sourceLayerArea.y,
    };
  }

  fetchResultGroups = async (requestId) => {
    try {
      const resultGroups = await localServerApi.getAllResults()

      const thisRequestGroup = resultGroups.find(result => result.request_id === requestId)
      if (thisRequestGroup) {
        // TODO: this doesn't seem to help Windows render faster. Fix
        const thumbnailImages = thisRequestGroup.group_items.map(group_item => `${STATIC_FILES_URL}/${group_item.thumbnail_file_name}`)
        console.log("Preloading images", thumbnailImages)
        await preloadImages(thumbnailImages)
      }
      return resultGroups
    } catch (e) {
      console.log("Error generating results images")
      console.error(e);
      return []
    }
  }

  startCheckingProgressForRequest = async () => {
    try {
      let response = await localServerApi.getProgress()
      console.log("Server progress response: ", JSON.stringify(response, null, 2))
      while (response.is_processing) {
        // Report progress of at least something to have more explicit visual progress bar feedback
        const displayProgress = Math.max(Math.round(response.progress * 100), 3)

        // Report the progress and start allowing cancellations. This won't run after the dream method has completed
        // because progress should already be null at that point
        this.props.onProgress({
          progress: displayProgress,
          canCancelProgress: true,
        })
        console.log(`Progress: ${displayProgress}, is processing: ${response.is_processing}`)

        await new Promise(resolve => setTimeout(resolve, 1000));
        response = await localServerApi.getProgress()
        console.log("Server progress response: ", JSON.stringify(response, null, 2))
      }
    } catch (e) {
      console.error(e);
    }
  }

  onInferenceTypeChange = (inferenceType) => {
    this.setState({ inferenceType })
  }

  onPromptChange = (prompt) => {
    this.setState({ prompt });
  }

  onNegativePromptChange = (negativePrompt) => {
    this.setState({ negativePrompt });
  }

  onImageCountChange = (imageCount) => {
    this.setState({ imageCount });
  }

  onSamplingMethodChange = (samplingMethod) => {
    this.setState({ samplingMethod });
  }

  onSamplingStepsChange = (samplingSteps) => {
    this.setState({ samplingSteps });
  }

  onMaskBlurChange = (maskBlur) => {
    this.setState({ maskBlur });
  }

  onMaskedContentChange = (maskedContent) => {
    this.setState({ maskedContent });
  }

  onMaskSourceChange = (maskSource) => this.setState({maskSource});
  onSelectionInvertChange = (selectionInvert) => this.setState({selectionInvert});
  onSelectionFeatherChange = (selectionFeather) => this.setState({selectionFeather});
  onSelectionExpandChange = (selectionExpand) => this.setState({selectionExpand});

  onRestoreFacesChange = (restoreFaces) => {
    this.setState({ restoreFaces });
  }

  onIsAdvancedOptionsExpandedChange = (isAdvancedOptionsExpanded) => {
    this.setState({ isAdvancedOptionsExpanded });
  }

  onShowTxt2ImgInstructionsChange = (showTxt2ImgInstructions) => {
    this.setState({ showTxt2ImgInstructions });
  }

  onShowImg2ImgInstructionsChange = (showImg2ImgInstructions) => {
    this.setState({ showImg2ImgInstructions });
  }

  onShowInpaintInstructionsChange = (showInpaintInstructions) => {
    this.setState({ showInpaintInstructions });
  }

  render() {
    const {
      inferenceType,
      prompt,
      negativePrompt,
      imageCount,
      samplingMethod,
      samplingSteps,
      maskBlur,
      maskedContent,
      maskSource,
      selectionInvert,
      selectionFeather,
      selectionExpand,
      restoreFaces,
      isAdvancedOptionsExpanded,
      showTxt2ImgInstructions,
      showImg2ImgInstructions,
      showInpaintInstructions,
    } = this.state;
    const {
      isProcessing,
      canCancelProgress,
      sourceLayer,
      onSourceLayerChange,
      isLoadingModels,
      onIsLoadingModelsChange,
      seed,
      onSeedChange,
      cfgScale,
      onCfgScaleChange,
      denoisingStrength,
      onDenoisingStrengthChange,
      storedPrompts,
      onStoredPromptsChange,
      progress,
    } = this.props;
    const isImg2ImgOrInpainting = inferenceType === InferenceType.IMG_2_IMG || inferenceType === InferenceType.INPAINT;
    const cancelButtonShown = isProcessing
    const cancelButtonDisabled = !canCancelProgress
    const dreamButtonDisabled = isLoadingModels || (isImg2ImgOrInpainting && !sourceLayer);
    const isModelDropdownDisabled = isProcessing;
    const seedSummary = seed === undefined || seed === null || seed === "" || seed === -1 ? "random" : seed;
    const advancedSummary = `Seed: ${seedSummary} · CFG: ${cfgScale}${isImg2ImgOrInpainting ? ` · Denoise: ${denoisingStrength}` : ""}`;

    return (
      <>
        <div className="container flexColumn">
          <div className="workflowZone setupZone">
          <sp-label class="zoneLabel">MODE / MODEL</sp-label>
          <InferenceTypeSelection
            inferenceType={inferenceType}
            onInferenceTypeChange={(inferenceType) => this.onInferenceTypeChange(inferenceType)}
          />
          <Space2 />

          <InstructionsBanner
            inferenceType={inferenceType}
            showTxt2ImgInstructions={showTxt2ImgInstructions}
            onShowTxt2ImgInstructionsChange={this.onShowTxt2ImgInstructionsChange}
            showImg2ImgInstructions={showImg2ImgInstructions}
            onShowImg2ImgInstructionsChange={this.onShowImg2ImgInstructionsChange}
            showInpaintInstructions={showInpaintInstructions}
            onShowInpaintInstructionsChange={this.onShowInpaintInstructionsChange}
          />
          <Space2 />

          <ModelsDropdown
            disabled={isModelDropdownDisabled}
            isLoadingModels={isLoadingModels}
            onIsLoadingModelsChange={onIsLoadingModelsChange}
          />
          </div>

          <div className="workflowZone promptZone">
            <sp-label class="zoneLabel">PROMPT</sp-label>
            <PromptControls
              prompt={prompt}
              onPromptChange={(prompt) => this.onPromptChange(prompt)}
              negativePrompt={negativePrompt}
              onNegativePromptChange={(negativePrompt) => this.onNegativePromptChange(negativePrompt)}
              storedPrompts={storedPrompts}
              onStoredPromptsChange={onStoredPromptsChange}
            />
          </div>

          <div className="workflowZone sourceMaskZone">
          <sp-label class="zoneLabel">SOURCE / MASK</sp-label>
          <SourceLayerControls
            inferenceType={inferenceType}
            sourceLayer={sourceLayer}
            onSourceLayerChange={onSourceLayerChange}
          />

          <MaskLayerControls
            inferenceType={inferenceType}
            maskSource={maskSource}
            selectionInvert={selectionInvert}
            selectionFeather={selectionFeather}
            selectionExpand={selectionExpand}
            onMaskSourceChange={this.onMaskSourceChange}
            onSelectionInvertChange={this.onSelectionInvertChange}
            onSelectionFeatherChange={this.onSelectionFeatherChange}
            onSelectionExpandChange={this.onSelectionExpandChange}
          />
          </div>

          <div className="workflowZone generationZone">
            <sp-slider
              min="1"
              max="20"
              value={imageCount}
              value-label=" images"
              onInput={(e) => this.onImageCountChange(e.target.value)}
            >
              <sp-label slot="label">Number of images</sp-label>
            </sp-slider>
            {cancelButtonShown ? (
              <sp-button
                class="dreamButton secondaryAction"
                variant="secondary"
                disabled={trueOrUndefined(cancelButtonDisabled)}
                onClick={() => this.onCancelButtonClick()}
              >Cancel</sp-button>
            ) : (
              <sp-button
                class="dreamButton primaryAction"
                variant="cta"
                disabled={trueOrUndefined(dreamButtonDisabled)}
                onClick={() => this.onDreamButtonClick()}
              >Generate</sp-button>
            )}
            {isProcessing ? (
              <div className="generateProgressBarContainer">
                <sp-progressbar class="generateProgressBar" max={100} value={progress}></sp-progressbar>
              </div>
            ) : null}
          </div>

          <div className="workflowZone advancedZone">
            <div className="advancedSummary">{advancedSummary}</div>
            {isAdvancedOptionsExpanded ? (
              <div className="advancedGenerationControls">
                <SeedCheckboxAndInput
                  seed={seed}
                  onSeedChange={onSeedChange}
                ></SeedCheckboxAndInput>

          <CfgScaleCheckboxAndInput
            cfgScale={cfgScale}
            onCfgScaleChange={onCfgScaleChange}
          ></CfgScaleCheckboxAndInput>

                <DenoisingStrengthCheckboxAndInput
            inferenceType={inferenceType}
            denoisingStrength={denoisingStrength}
            onDenoisingStrengthChange={onDenoisingStrengthChange}
                ></DenoisingStrengthCheckboxAndInput>
              </div>
            ) : null}

          <AdvancedOptions
            inferenceType={inferenceType}
            samplingMethod={samplingMethod}
            onSamplingMethodChange={this.onSamplingMethodChange}
            samplingSteps={samplingSteps}
            onSamplingStepsChange={this.onSamplingStepsChange}
            maskBlur={maskBlur}
            onMaskBlurChange={this.onMaskBlurChange}
            maskedContent={maskedContent}
            onMaskedContentChange={this.onMaskedContentChange}
            restoreFaces={restoreFaces}
            onRestoreFacesChange={this.onRestoreFacesChange}
            isAdvancedOptionsExpanded={isAdvancedOptionsExpanded}
            onIsAdvancedOptionsExpandedChange={this.onIsAdvancedOptionsExpandedChange}
          ></AdvancedOptions>
          </div>
        </div>
      </>
    );
  }
}

export const DreamTab = (props) => {
  const modalContext = useContext(ModalContext);
  const alertContext = useContext(AlertContext);

  return (
    <DreamTabInternal {...props} modalContext={modalContext} alertContext={alertContext}/>
  );
}
