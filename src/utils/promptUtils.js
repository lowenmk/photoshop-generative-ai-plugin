export const buildLoraToken = (name, weight) => `<lora:${name}:${Number(weight).toFixed(2).replace(/0+$/, '').replace(/\\.$/, '')}>`;

export const insertLoraToken = (prompt, name, weight) => {
  const token = buildLoraToken(name, weight);
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const existing = new RegExp(`<lora:${escapedName}:[-+]?\\d+(?:\\.\\d+)?\\s*>`, "i");
  const replaced = (prompt || "").replace(existing, token);
  if (replaced !== (prompt || "")) return replaced;
  return replaced.trim() ? `${replaced.replace(/\\s+$/, '')}, ${token}` : token;
};

export const appendPromptShortcut = (prompt, shortcut) => {
  if (!shortcut) return prompt || "";
  const current = (prompt || "").trim();
  return current ? `${current.replace(/[,\\s]+$/, '')}, ${shortcut}` : shortcut;
};
