import "./Modals.css";

import {SettingsModal} from "./SettingsModal";
import {LocalServerUnavailableModal} from "./LocalServerUnavailableModal";
import {Automatic1111UnavailableModal} from "./Automatic1111UnavailableModal";
import {BadDocumentStateModal} from "./BadDocumentStateModal";
import {ControlNetInstallModal} from "./ControlNetInstallModal";

const React = require('react');

export const ModalName = Object.freeze({
  SETTINGS: "settings",
  LOCAL_SERVER_UNAVAILABLE: "local_server_unavailable",
  AUTOMATIC1111_UNAVAILABLE: "automatic1111_unavailable",
  BAD_DOCUMENT_STATE: "bad_document_state",
  CONTROLNET_INSTALL: "controlnet_install",
});

export const FullScreenModalSelector = ({modalName}) => {
  if (modalName === ModalName.SETTINGS) {
    return (<SettingsModal />)
  }
  if (modalName === ModalName.LOCAL_SERVER_UNAVAILABLE) {
    return (<LocalServerUnavailableModal />)
  }
  if (modalName === ModalName.AUTOMATIC1111_UNAVAILABLE) {
    return (<Automatic1111UnavailableModal />)
  }
  if (modalName === ModalName.BAD_DOCUMENT_STATE) {
    return (<BadDocumentStateModal />)
  }
  if (modalName === ModalName.CONTROLNET_INSTALL) {
    return (<ControlNetInstallModal />)
  }
  return null;
}
