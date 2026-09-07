import React from "react";
import {DEFAULT_DREAM_TAB_SETTINGS, DEFAULT_MAIN_PANEL_SETTINGS, DEFAULT_MODEL_SETTINGS} from "./Constants";

const MAIN_PANEL_SETTINGS_KEY = "MAIN_PANEL_SETTINGS"
const DREAM_TAB_SETTINGS_KEY = "DREAM_TAB_SETTINGS"
const RESULTS_TAB_SETTINGS_KEY = "RESULTS_TAB_SETTINGS"
const PROMPTS_TAB_SETTINGS_KEY = "PROMPTS_TAB_SETTINGS"
const MODEL_SETTINGS_KEY = "MODEL_SETTINGS"

// To frequent seems redundant, too infrequent is bad for UX as latest changes won't be remembered
const DREAM_SETTINGS_WRITE_FREQUENCY_MS = 3000;

const DEFAULT_RESULTS_TAB_SETTINGS = {
  collapsedResultsMap: {},
}

const DEFAULT_PROMPTS_TAB_SETTINGS = {
  showInstructions: true,
  showAsText: false,
}

const areObjectsEqual = (obj1, obj2) => {
  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);

  return keys1.length === keys2.length && Object.keys(obj1).every(key => obj1[key] === obj2[key]);
}


class SettingsStorage {
  dreamSettingsPendingWrite;

  constructor() {
    this.dreamSettingsPendingWrite = {}
    setInterval(this.writePendingDreamSettingsToLocalStorage, DREAM_SETTINGS_WRITE_FREQUENCY_MS);
  }

  getDreamSettings() {
    const storedSettings = localStorage.getItem(DREAM_TAB_SETTINGS_KEY);
    if (!storedSettings) {
      return DEFAULT_DREAM_TAB_SETTINGS;
    }
    try {
      const parsed = JSON.parse(storedSettings);
      const normalized = {...parsed};
      if (Object.prototype.hasOwnProperty.call(normalized, "selectionInvert")) {
        if (typeof normalized.selectionInvert === "string") {
          normalized.selectionInvert = normalized.selectionInvert.toLowerCase() === "true";
        } else {
          normalized.selectionInvert = Boolean(normalized.selectionInvert);
        }
      }
      // console.log('Loading settings', JSON.stringify(parsed, null, 2))
      return {...DEFAULT_DREAM_TAB_SETTINGS, ...normalized};
    } catch (e) {
      console.error("Failed to parse Dream settings", storedSettings)
      return DEFAULT_DREAM_TAB_SETTINGS
    }
  }

  saveDreamSettingsBatched(settings) {
    this.dreamSettingsPendingWrite = {
      ...this.dreamSettingsPendingWrite,
      ...settings,
    }
  }

  snapshotRawSetting(key) {
    const value = localStorage.getItem(key);
    return {exists: value !== null, value};
  }

  restoreRawSetting(key, snapshot) {
    if (key === DREAM_TAB_SETTINGS_KEY) {
      this.dreamSettingsPendingWrite = {};
    }
    if (snapshot && snapshot.exists) {
      localStorage.setItem(key, snapshot.value);
    } else {
      localStorage.removeItem(key);
    }
  }

  snapshotDreamSettingsRaw() {
    return this.snapshotRawSetting(DREAM_TAB_SETTINGS_KEY);
  }

  restoreDreamSettingsRaw(snapshot) {
    this.restoreRawSetting(DREAM_TAB_SETTINGS_KEY, snapshot);
  }

  snapshotModelSettingsRaw() {
    return this.snapshotRawSetting(MODEL_SETTINGS_KEY);
  }

  restoreModelSettingsRaw(snapshot) {
    this.restoreRawSetting(MODEL_SETTINGS_KEY, snapshot);
  }

  writePendingDreamSettingsToLocalStorage = () => {
    // Batching settings writes is good because otherwise we will write them e.g. with every button press when user
    // types the prompt
    const currentSettings = this.getDreamSettings()
    const updatedSettings = {
      ...currentSettings,
      ...this.dreamSettingsPendingWrite,
    }
    if (areObjectsEqual(currentSettings, updatedSettings)) {
      return;
    }

    this.dreamSettingsPendingWrite = {};
    console.log('Saving Dream settings', JSON.stringify(updatedSettings, null, 2))
    localStorage.setItem(DREAM_TAB_SETTINGS_KEY, JSON.stringify(updatedSettings));
  }

  getResultsSettings() {
    const storedSettings = localStorage.getItem(RESULTS_TAB_SETTINGS_KEY);
    if (!storedSettings) {
      return DEFAULT_RESULTS_TAB_SETTINGS;
    }
    try {
      return JSON.parse(storedSettings);
    } catch (e) {
      console.error("Failed to parse Results settings", storedSettings)
      return DEFAULT_RESULTS_TAB_SETTINGS
    }
  }

  saveResultsSettingsSync(updatedSettings) {
    // Results panel does not expect us to merge with the previous state
    console.log('Saving Results settings', JSON.stringify(updatedSettings, null, 2))
    localStorage.setItem(RESULTS_TAB_SETTINGS_KEY, JSON.stringify(updatedSettings));
  }

  getPromptsSettings() {
    const storedSettings = localStorage.getItem(PROMPTS_TAB_SETTINGS_KEY);
    if (!storedSettings) {
      return DEFAULT_PROMPTS_TAB_SETTINGS;
    }
    try {
      return JSON.parse(storedSettings);
    } catch (e) {
      console.error("Failed to parse Prompts settings", storedSettings)
      return DEFAULT_PROMPTS_TAB_SETTINGS
    }
  }

  updatePromptsSettingsSync(settings) {
    // Prompts panel has few settings, so it should be ok to save them synchronously
    const currentSettings = this.getPromptsSettings()
    const updatedSettings = {
      ...currentSettings,
      ...settings,
    }
    console.log('Saving Prompts settings', JSON.stringify(updatedSettings, null, 2))
    localStorage.setItem(PROMPTS_TAB_SETTINGS_KEY, JSON.stringify(updatedSettings));
  }

  getMainPanelSettings() {
    const storedSettings = localStorage.getItem(MAIN_PANEL_SETTINGS_KEY);
    if (!storedSettings) {
      return DEFAULT_MAIN_PANEL_SETTINGS;
    }
    try {
      return JSON.parse(storedSettings);
    } catch (e) {
      console.error("Failed to parse Main Panel settings", storedSettings)
      return DEFAULT_MAIN_PANEL_SETTINGS
    }
  }

  updateMainPanelSettingsSync(settings) {
    // Main panel has few settings, so it should be ok to save them synchronously
    const currentSettings = this.getMainPanelSettings()
    const updatedSettings = {
      ...currentSettings,
      ...settings,
    }
    console.log('Saving main panel settings', JSON.stringify(updatedSettings, null, 2))
    localStorage.setItem(MAIN_PANEL_SETTINGS_KEY, JSON.stringify(updatedSettings));
  }

  getModelSettings(modelHash) {
    if (!modelHash) return {...DEFAULT_MODEL_SETTINGS};
    const storedSettings = localStorage.getItem(MODEL_SETTINGS_KEY);
    if (!storedSettings) return {...DEFAULT_MODEL_SETTINGS};
    try {
      const allModelSettings = JSON.parse(storedSettings);
      const profile = allModelSettings && typeof allModelSettings === "object"
        ? allModelSettings[modelHash]
        : null;
      return {
        ...DEFAULT_MODEL_SETTINGS,
        ...(profile && typeof profile === "object" ? profile : {}),
      };
    } catch (e) {
      console.error("Failed to parse model settings", storedSettings);
      return {...DEFAULT_MODEL_SETTINGS};
    }
  }

  hasModelSettings(modelHash) {
    if (!modelHash) return false;
    const storedSettings = localStorage.getItem(MODEL_SETTINGS_KEY);
    if (!storedSettings) return false;
    try {
      const allModelSettings = JSON.parse(storedSettings);
      return Boolean(allModelSettings && typeof allModelSettings === "object" && allModelSettings[modelHash]);
    } catch (e) {
      console.error("Failed to parse model settings", storedSettings);
      return false;
    }
  }

  saveModelSettings(modelHash, settings) {
    if (!modelHash) return;
    const storedSettings = localStorage.getItem(MODEL_SETTINGS_KEY);
    let allModelSettings = {};
    if (storedSettings) {
      try {
        const parsed = JSON.parse(storedSettings);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          allModelSettings = parsed;
        }
      } catch (e) {
        console.error("Failed to parse model settings before save", storedSettings);
      }
    }
    allModelSettings[modelHash] = {
      ...DEFAULT_MODEL_SETTINGS,
      ...settings,
    };
    localStorage.setItem(MODEL_SETTINGS_KEY, JSON.stringify(allModelSettings));
  }

  removeModelSettings(modelHash) {
    if (!modelHash) return;
    const storedSettings = localStorage.getItem(MODEL_SETTINGS_KEY);
    if (!storedSettings) return;
    try {
      const allModelSettings = JSON.parse(storedSettings);
      if (!allModelSettings || typeof allModelSettings !== "object") return;
      delete allModelSettings[modelHash];
      localStorage.setItem(MODEL_SETTINGS_KEY, JSON.stringify(allModelSettings));
    } catch (e) {
      console.error("Failed to parse model settings before removal", storedSettings);
    }
  }
}

export const settingsStorage = new SettingsStorage();
