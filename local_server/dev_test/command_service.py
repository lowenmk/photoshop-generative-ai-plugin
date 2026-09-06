import threading
import time
import uuid
from collections import deque


ALLOWED_COMMAND_TYPES = {
    "get_state",
    "create_test_document",
    "close_test_document",
    "set_selection",
    "clear_selection",
    "export_current_selection_mask",
    "generate_txt2img",
    "generate_img2img",
    "generate_inpaint",
    "cleanup_result_batch",
    "model_settings_round_trip",
    "lora_prompt_tokens",
    "history_use_prompt_remount",
    "history_reuse_sampler_steps_remount",
    "lora_refresh_race",
    "lora_selection_reconciliation",
    "place_new_layer",
    "place_replace_area",
    "place_open_image",
    "set_failure_mode",
    "clear_failure_mode",
}


class CommandBroker:
    def __init__(self):
        self._lock = threading.Lock()
        self._commands = {}
        self._queue = deque()
        self.last_plugin_seen = None
        self.last_state = None

    def enqueue(self, command_type, payload):
        if command_type not in ALLOWED_COMMAND_TYPES:
            raise ValueError(f"Unknown development command type: {command_type}")
        command_id = str(uuid.uuid4())
        command = {
            "command_id": command_id,
            "command_type": command_type,
            "payload": payload or {},
            "created": time.time(),
            "status": "queued",
            "result": None,
            "error": None,
        }
        with self._lock:
            self._commands[command_id] = command
            self._queue.append(command_id)
        return command

    def claim_next(self):
        with self._lock:
            self.last_plugin_seen = time.time()
            while self._queue:
                command_id = self._queue.popleft()
                command = self._commands.get(command_id)
                if command and command["status"] == "queued":
                    command["status"] = "claimed"
                    return dict(command)
        return None

    def complete(self, command_id, result, duration_ms):
        with self._lock:
            command = self._commands.get(command_id)
            if not command or command["status"] != "claimed":
                return False
            command.update(status="completed", result=result, error=None,
                           duration_ms=duration_ms)
            if command.get("command_type") == "get_state":
                self.last_state = result
            return True

    def fail(self, command_id, error, duration_ms):
        with self._lock:
            command = self._commands.get(command_id)
            if not command or command["status"] != "claimed":
                return False
            command.update(status="failed", result=None, error=error,
                           duration_ms=duration_ms)
            return True

    def expire(self, command_id):
        with self._lock:
            command = self._commands.get(command_id)
            if not command or command["status"] in {"completed", "failed"}:
                return False
            command.update(
                status="failed",
                result=None,
                error={"type": "TimeoutError", "message": "Photoshop test command timed out"},
            )
            return True

    def get(self, command_id):
        with self._lock:
            command = self._commands.get(command_id)
            return dict(command) if command else None

    def wait(self, command_id, timeout_seconds):
        deadline = time.monotonic() + timeout_seconds
        while time.monotonic() < deadline:
            command = self.get(command_id)
            if command and command["status"] in {"completed", "failed"}:
                return command
            time.sleep(0.05)
        return self.get(command_id)

    def health(self):
        now = time.time()
        plugin_connected = (
            self.last_plugin_seen is not None and now - self.last_plugin_seen <= 3
        )
        return {
            "bridge": True,
            "dev_test_api": True,
            "plugin_connected": plugin_connected,
            "photoshop_ready": plugin_connected and self.last_state is not None,
        }


broker = CommandBroker()
