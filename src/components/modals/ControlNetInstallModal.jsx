import "./Modals.css";

const React = require("react");
const {useContext, useState} = require("react");
const {ModalContext} = require("../../contexts/ModalContext");
const {localServerApi} = require("../../api/localServerApi");
const {photoshopApp} = require("../../photoshop/PhotoshopApp");

export const ControlNetInstallModal = () => {
  const modalContext = useContext(ModalContext);
  const [root, setRoot] = useState("");
  const [status, setStatus] = useState("");
  const [conflict, setConflict] = useState(false);
  const [installing, setInstalling] = useState(false);

  const close = () => modalContext.setModal({modalName: null});
  const browse = async () => {
    try {
      const selectedPath = await photoshopApp.pickFolder();
      if (selectedPath) setRoot(selectedPath);
    } catch (error) {
      setStatus(error?.message || String(error));
    }
  };
  const install = async (replaceExisting = false) => {
    if (!root.trim()) {
      setStatus("Choose an Automatic1111 root directory.");
      return;
    }
    setInstalling(true);
    setStatus("Installing ControlNet...");
    try {
      const result = await localServerApi.installControlNet(root.trim(), replaceExisting);
      if (result.status === "conflict") {
        setConflict(true);
        setStatus(result.message);
      } else if (result.status === "invalid" || result.status === "error") {
        setStatus(result.message);
      } else {
        setConflict(false);
        setStatus(result.message);
      }
    } catch (error) {
      setStatus(error?.message || String(error));
    } finally {
      setInstalling(false);
    }
  };
  const installed = status.startsWith("ControlNet installed") || status.startsWith("ControlNet is already installed");

  return (
    <div className="controlNetInstallModal">
      <sp-heading size="M">Install ControlNet</sp-heading>
      <sp-textfield value={root} onInput={e => setRoot(e.target.value)}>
        <sp-label slot="label">Automatic1111 Folder</sp-label>
      </sp-textfield>
      <div className="container flexRow modalButtonRow">
        <sp-button variant="secondary" onClick={browse} disabled={installing}>Browse...</sp-button>
      </div>
      {status ? <sp-help-text>{status}</sp-help-text> : null}
      {conflict ? (
        <div className="container flexRow modalButtonRow">
          <sp-button variant="negative" onClick={() => install(true)} disabled={installing}>Replace</sp-button>
          <sp-button variant="secondary" onClick={() => { setConflict(false); setStatus(""); }} disabled={installing}>Cancel</sp-button>
        </div>
      ) : null}
      <div className="container flexRow modalButtonRow">
        {!conflict && !installed ? <sp-button variant="cta" onClick={() => install(false)} disabled={installing}>Install</sp-button> : null}
        {installed ? <sp-button variant="cta" onClick={close}>Close</sp-button> : null}
        {!installed && !conflict ? <sp-button variant="secondary" onClick={close} disabled={installing}>Cancel</sp-button> : null}
      </div>
    </div>
  );
};
