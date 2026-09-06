import React, {useEffect, useState} from "react";
import {localServerApi} from "../../../api/localServerApi";
import {trueOrUndefined} from "../../../utils/utils";
import "../DreamTab.css";

export const ControlNetControls = ({inferenceType, sourceLayer, value, onChange}) => {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const settings = value || {enabled: false, model: "", module: "canny", weight: 1, start: 0, end: 1};

  const loadStatus = async (refresh = false) => {
    setLoading(true);
    try {
      const next = refresh ? await localServerApi.refreshControlNet() : await localServerApi.getControlNetStatus();
      setStatus(next);
    } catch (error) {
      setStatus({available: false, models: [], modules: [], reason: error?.message || "ControlNet unavailable"});
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadStatus(); }, []);

  const update = changes => onChange({...settings, ...changes});
  const unavailable = loading || !status?.available;
  const generationNeedsSource = inferenceType === "txt2img" && !sourceLayer;

  return (
    <div className="controlNetPanel">
      <div className="container flexRow controlNetHeader">
        <sp-label class="zoneLabel">CONTROLNET</sp-label>
        <sp-action-button class="tertiaryAction" title="Refresh ControlNet inventory" onClick={() => loadStatus(true)}>Refresh</sp-action-button>
      </div>
      {!loading && !status?.available ? (
        <sp-help-text>Unavailable: {status?.reason || "ControlNet extension not detected"}</sp-help-text>
      ) : null}
      <div className="container flexColumn">
        <sp-checkbox
          checked={trueOrUndefined(settings.enabled && !unavailable && !generationNeedsSource)}
          disabled={trueOrUndefined(unavailable || generationNeedsSource)}
          onClick={() => update({enabled: !settings.enabled})}
        >Enable ControlNet</sp-checkbox>
        {generationNeedsSource ? <sp-help-text>Choose a source layer for ControlNet input.</sp-help-text> : null}
      </div>
      {!unavailable ? (
        <>
          <sp-picker class="modelDropdown" disabled={trueOrUndefined(!settings.enabled)}>
            <sp-label slot="label">Model</sp-label>
            <sp-menu slot="options" onClick={e => update({model: e.target.value})}>
              {status.models.map(model => <sp-menu-item key={model} value={model} selected={trueOrUndefined(model === settings.model)}>{model}</sp-menu-item>)}
            </sp-menu>
          </sp-picker>
          <sp-picker class="modelDropdown" disabled={trueOrUndefined(!settings.enabled)}>
            <sp-label slot="label">Preprocessor</sp-label>
            <sp-menu slot="options" onClick={e => update({module: e.target.value})}>
              {status.modules.map(module => <sp-menu-item key={module} value={module} selected={trueOrUndefined(module === settings.module)}>{module}</sp-menu-item>)}
            </sp-menu>
          </sp-picker>
          <sp-slider min="0" max="2" step="0.05" value={settings.weight} disabled={trueOrUndefined(!settings.enabled)} onInput={e => update({weight: Number(e.target.value)})}>
            <sp-label slot="label">Weight: {settings.weight}</sp-label>
          </sp-slider>
          <div className="container flexRow controlNetRange">
            <sp-slider min="0" max="1" step="0.05" value={settings.start} disabled={trueOrUndefined(!settings.enabled)} onInput={e => update({start: Number(e.target.value)})}><sp-label slot="label">Start</sp-label></sp-slider>
            <sp-slider min="0" max="1" step="0.05" value={settings.end} disabled={trueOrUndefined(!settings.enabled)} onInput={e => update({end: Number(e.target.value)})}><sp-label slot="label">End</sp-label></sp-slider>
          </div>
        </>
      ) : null}
    </div>
  );
};
