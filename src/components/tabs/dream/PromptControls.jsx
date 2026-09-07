import React, {useContext, useEffect, useState} from "react";
import {CurlyBracesIcon, RefreshIcon, SaveIcon} from "../../common/Icons";
import {Space2} from "../../common/Spaces";
import {AlertContext} from "../../../contexts/AlertContext";
import {localServerApi} from "../../../api/localServerApi";
import {appendPromptShortcut, insertLoraToken} from "../../../utils/promptUtils";
import {reconcileLoraSelection} from "../../../utils/loraUtils";

const NON_ALPHANUMERIC_REGEX = /[^a-z0-9 ]+/g;
const WORDS_COUNT_FOR_PROMPT_KEY = 3;

const PromptControl = ({label, prompt, onPromptChange, storedPrompts, onStoredPromptsChange}) => {
  const [showStoredPrompts, setShowStoredPrompts] = useState(false);
  const alertContext = useContext(AlertContext);

  const onStorePrompt = () => {
    if (!prompt.trim()) { alertContext.setError(<>Please type a prompt to save a shortcut</>); return; }
    const promptKey = prompt.toLowerCase().replace(NON_ALPHANUMERIC_REGEX, " ").split(" ")
      .filter(word => !!word).slice(0, WORDS_COUNT_FOR_PROMPT_KEY).join(" ");
    if (storedPrompts.find(storedPrompt => storedPrompt.promptKey === promptKey)) {
      alertContext.setError(<>Prompt shortcut {`{${promptKey}}`} already exists</>); return;
    }
    const newPrompt = {promptKey, prompt};
    onStoredPromptsChange([...storedPrompts, newPrompt], newPrompt);
    alertContext.setSuccess(<>Added prompt shortcut {`{${promptKey}}`}</>);
  };

  if (showStoredPrompts) {
    return <div className="container flexColumn storedPromptKeysSelectionAreaContainer">
      <sp-body size="S">Select a prompt shortcut to add <sp-link onClick={() => setShowStoredPrompts(false)}>or cancel</sp-link></sp-body>
      <Space2 />
      {storedPrompts.length ? <div className="container flexRow flexWrap">
        {storedPrompts.map(storedPrompt => { const shortcut = `{${storedPrompt.promptKey}}`; return <sp-action-button class="promptKeyButton" key={storedPrompt.promptKey} onClick={() => { onPromptChange(appendPromptShortcut(prompt, shortcut)); setShowStoredPrompts(false); }}>{shortcut}</sp-action-button>; })}
      </div> : <sp-body size="S">No saved prompts yet.</sp-body>}
    </div>;
  }

  return <div className="container flexColumn promptControl">
    <sp-body size="S" class="promptFieldLabel">{label}</sp-body>
    <div className="container flexRow">
      <sp-textarea class="dreamPromptTextArea" value={prompt} onInput={(e) => onPromptChange(e.target.value)} />
      <div className="container flexColumn">
        <sp-action-button class="iconButton" title="Add a prompt shortcut" onClick={() => setShowStoredPrompts(true)}><span slot="icon"><CurlyBracesIcon /></span></sp-action-button>
        <sp-action-button class="iconButton" title="Save prompt as a shortcut" onClick={onStorePrompt}><span slot="icon"><SaveIcon /></span></sp-action-button>
      </div>
    </div>
    <sp-action-button class="promptClearButton" title={`Clear ${label}`} onClick={() => onPromptChange("")}>Clear</sp-action-button>
  </div>;
};

const LoraControls = ({prompt, onPromptChange}) => {
  const alertContext = useContext(AlertContext);
  const [loras, setLoras] = useState([]);
  const [selectedName, setSelectedName] = useState("");
  const [weight, setWeight] = useState("1.0");
  const [loading, setLoading] = useState(false);
  const loadLoras = async (refresh = false) => {
    setLoading(true);
    try {
      const values = refresh ? await localServerApi.refreshAvailableLoras() : await localServerApi.getAvailableLoras();
      setLoras(values);
      setSelectedName(currentName => reconcileLoraSelection(values, currentName));
    }
    catch (error) { alertContext.setError(<>Could not load LoRAs</>); }
    finally { setLoading(false); }
  };
  useEffect(() => { loadLoras(); }, []);
  const addLora = () => { if (selectedName) onPromptChange(insertLoraToken(prompt, selectedName, Math.max(-2, Math.min(2, Number(weight) || 0)))); };
  return <div className="container flexColumn loraControls">
    <sp-body size="S">LoRA</sp-body>
    <div className="container flexRow flexWrap">
      <sp-picker class="loraPicker" value={selectedName} disabled={loading ? true : undefined}><sp-menu slot="options" onClick={(e) => setSelectedName(e.target.value)}>{loras.map(lora => <sp-menu-item key={lora.name} value={lora.name}>{lora.alias || lora.name}</sp-menu-item>)}</sp-menu></sp-picker>
      <sp-textfield class="loraWeight" type="number" min="-2" max="2" step="0.1" value={weight} onInput={(e) => setWeight(e.target.value)} />
      <sp-action-button title="Refresh LoRAs" onClick={() => loadLoras(true)}><span slot="icon"><RefreshIcon /></span></sp-action-button>
      <sp-action-button onClick={addLora}>Add</sp-action-button>
    </div>
  </div>;
};

export const PromptControls = ({prompt, onPromptChange, negativePrompt, onNegativePromptChange, storedPrompts, onStoredPromptsChange}) => <>
  <PromptControl label="Prompt" prompt={prompt} onPromptChange={onPromptChange} storedPrompts={storedPrompts} onStoredPromptsChange={onStoredPromptsChange} />
  <PromptControl label="Negative Prompt" prompt={negativePrompt} onPromptChange={onNegativePromptChange} storedPrompts={storedPrompts} onStoredPromptsChange={onStoredPromptsChange} />
  <LoraControls prompt={prompt} onPromptChange={onPromptChange} />
</>;
