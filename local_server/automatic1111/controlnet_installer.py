from pathlib import Path
import shutil
from uuid import uuid4


FROZEN_CONTROLNET_SHA = "56cec5b2958edf3b1807b7e7b2b1b5186dbd2f81"
REQUIRED_A1111_FILES = ("webui.py", "webui-user.bat")
REQUIRED_A1111_DIRECTORIES = ("modules", "extensions")
MARKER_NAME = "ANZOTH_VENDOR_MARKER.txt"


def get_vendored_controlnet_root() -> Path:
    return Path(__file__).resolve().parents[2] / "third_party" / "sd-webui-controlnet"


def validate_a1111_root(root_value: str) -> Path:
    if not isinstance(root_value, str) or not root_value.strip():
        raise ValueError("Choose an Automatic1111 root directory.")
    root = Path(root_value).expanduser().resolve()
    if not root.is_dir() or any(not (root / name).is_file() for name in REQUIRED_A1111_FILES):
        raise ValueError("The selected folder does not appear to be an Automatic1111 installation.")
    if any(not (root / name).is_dir() for name in REQUIRED_A1111_DIRECTORIES):
        raise ValueError("The selected folder does not appear to be an Automatic1111 installation.")
    return root


def _marker_matches(target: Path) -> bool:
    marker = target / MARKER_NAME
    if not marker.is_file():
        return False
    return any(
        line.strip() == f"upstream_commit={FROZEN_CONTROLNET_SHA}"
        for line in marker.read_text(encoding="utf-8").splitlines()
    )


def _copy_snapshot(source: Path, target: Path) -> None:
    if not source.is_dir():
        raise RuntimeError("The frozen ControlNet snapshot is missing from this plugin.")
    shutil.copytree(
        source,
        target,
        ignore=shutil.ignore_patterns(
            ".git", "__pycache__", ".github", "example", "samples", "tests", "unit_tests", "web_tests",
            "*.pyc", "*.data", "*.ckpt", "*.safetensors", "*.pt", "*.bin", "*.pth",
        ),
    )
    (target / MARKER_NAME).write_text(
        "upstream_repository=https://github.com/Mikubill/sd-webui-controlnet\n"
        f"upstream_commit={FROZEN_CONTROLNET_SHA}\n"
        "installed_by=easy-photoshop-stable-diffusion-plugin\n",
        encoding="utf-8",
    )


def install_controlnet(root_value: str, replace_existing: bool = False) -> dict:
    root = validate_a1111_root(root_value)
    target = root / "extensions" / "sd-webui-controlnet"

    if target.exists() and _marker_matches(target):
        return {"status": "already_installed", "message": "ControlNet is already installed."}
    if target.exists() and not replace_existing:
        return {"status": "conflict", "message": "An existing ControlNet installation was found."}

    backup = None
    if target.exists():
        backup = target.with_name(f"{target.name}.backup-{uuid4().hex[:8]}")
        target.rename(backup)
    try:
        _copy_snapshot(get_vendored_controlnet_root(), target)
    except Exception:
        if target.exists():
            shutil.rmtree(target)
        if backup is not None and backup.exists():
            backup.rename(target)
        raise

    return {
        "status": "installed",
        "message": "ControlNet installed. Restart Automatic1111 to activate it.",
        "backup_path": str(backup) if backup else None,
    }
