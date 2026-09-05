$ErrorActionPreference = "Stop"

# Test mode intentionally avoids Uvicorn --reload because its Windows child
# process does not reliably inherit EASYSD_DEV_TEST_API.
$env:EASYSD_DEV_TEST_API = "1"
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
& "$repoRoot\venv\Scripts\python.exe" -m uvicorn --app-dir="$repoRoot\local_server" main:app --port 8088
