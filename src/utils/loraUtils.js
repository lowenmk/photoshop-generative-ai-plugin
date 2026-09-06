export const reconcileLoraSelection = (loras, selectedName) => {
  if (loras.some(lora => lora.name === selectedName)) return selectedName;
  return loras[0]?.name || "";
};
