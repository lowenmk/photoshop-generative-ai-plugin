const {ajaxClient} = require("../api/ajaxClient");
const {photoshopDevHarness} = require("./PhotoshopDevHarness");

const POLL_INTERVAL_MS = 350;
const DISCOVERY_RETRY_INTERVAL_MS = 1000;
let started = false;
let disabled = false;
let pollInFlight = false;

const errorMessage = (error) => error?.message || String(error);

const schedulePoll = (delay = POLL_INTERVAL_MS) => {
  if (!disabled) setTimeout(poll, delay);
};

const report = async (commandId, startedAt, ok, value) => {
  const body = {
    ok,
    duration_ms: Date.now() - startedAt,
  };
  if (ok) body.result = value;
  else body.error = {type: value?.name || "Error", message: errorMessage(value)};
  await ajaxClient.post(`/dev/photoshop/command/${commandId}/result`, body);
};

const poll = async () => {
  if (disabled || pollInFlight) return;
  pollInFlight = true;
  try {
    const command = await ajaxClient.get("/dev/photoshop/command/next");
    if (command?.command_id) {
      const startedAt = Date.now();
      try {
        const result = await photoshopDevHarness.execute(command.command_type, command.payload || {});
        await report(command.command_id, startedAt, true, result);
      } catch (error) {
        console.error("[EasySD dev harness] command failed", command.command_type, error);
        try { await report(command.command_id, startedAt, false, error); } catch (reportError) {
          console.error("[EasySD dev harness] failed to report command", reportError);
        }
      }
    }
  } catch (error) {
    if (error?.status === 404) {
      disabled = true;
    } else if (error?.status !== 204 && !String(errorMessage(error)).includes("Cannot reach local server")) {
      console.error("[EasySD dev harness] poll failed", error);
    }
  } finally {
    pollInFlight = false;
    schedulePoll();
  }
};

const discover = async () => {
  if (disabled) return;
  try {
    const health = await ajaxClient.get("/dev/photoshop/health");
    if (health?.dev_test_api !== true) { disabled = true; return; }
    console.log("[EasySD dev harness] bridge discovered; starting command poll");
    poll();
  } catch (error) {
    if (error?.status === 404) {
      console.log("[EasySD dev harness] dev API unavailable; disabling agent");
      disabled = true;
      return;
    }
    if (!String(errorMessage(error)).includes("Cannot reach local server")) {
      console.error("[EasySD dev harness] discovery failed", error);
    }
    setTimeout(discover, DISCOVERY_RETRY_INTERVAL_MS);
  }
};

export const startPhotoshopDevTestAgent = async () => {
  if (started) return;
  started = true;
  console.log("[EasySD dev harness] agent starting");
  discover();
};
