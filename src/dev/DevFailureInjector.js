const FAILURE_POINTS = new Set([
  "after_selection_snapshot",
  "after_selection_mask_layer_create",
  "after_selection_mask_layer_create",
  "after_source_duplicate",
  "after_temp_result_open",
  "before_result_duplicate",
  "after_group_create",
  "before_group_move",
  "during_model_settings_round_trip",
]);

let activeFailurePoint = null;

export const setFailurePoint = (point) => {
  if (!FAILURE_POINTS.has(point)) throw new Error(`Unknown failure point: ${point}`);
  activeFailurePoint = point;
};

export const clearFailurePoint = () => { activeFailurePoint = null; };

export const throwIfFailurePoint = (point) => {
  if (activeFailurePoint === point) throw new Error(`Injected development failure at ${point}`);
};
