$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Split-Path -Parent $MyInvocation.MyCommand.Path)).Path
$pythonPath = Join-Path $repoRoot "venv\Scripts\python.exe"
$runtimeDirectory = Join-Path $repoRoot ".runtime"
$statePath = Join-Path $runtimeDirectory "test-bridge.json"
$supervisorPath = Join-Path $repoRoot "start-test-supervisor.ps1"
$expectedPort = 8088

function Get-ProcessRecord([int] $processId) {
    return Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
}

function Get-ProcessTree([int] $rootProcessId) {
    $records = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
    $tree = New-Object System.Collections.Generic.List[object]
    $queue = New-Object System.Collections.Generic.Queue[int]
    $queue.Enqueue($rootProcessId)
    while ($queue.Count -gt 0) {
        $currentId = $queue.Dequeue()
        $record = $records | Where-Object { $_.ProcessId -eq $currentId } | Select-Object -First 1
        if (-not $record) { continue }
        $tree.Add($record) | Out-Null
        foreach ($child in ($records | Where-Object { $_.ParentProcessId -eq $currentId })) {
            $queue.Enqueue([int]$child.ProcessId)
        }
    }
    return $tree.ToArray()
}

function Test-ExpectedBridgeCommand($record) {
    if (-not $record) { return $false }
    $commandLine = ([string]$record.CommandLine).ToLowerInvariant()
    $normalizedRepo = $repoRoot.Replace("/", "\").ToLowerInvariant()
    $normalizedPython = $pythonPath.Replace("/", "\").ToLowerInvariant()
    return $commandLine.Contains("uvicorn") -and
        $commandLine.Contains("--app-dir=local_server") -and
        $commandLine.Contains("--port 8088") -and
        ($commandLine.Contains($normalizedRepo) -or $commandLine.Contains($normalizedPython))
}

function Test-ActiveSupervisor($state) {
    if (-not $state -or -not $state.launcherPid) { return $false }
    $record = Get-ProcessRecord ([int]$state.launcherPid)
    if (-not $record) { return $false }
    $commandLine = ([string]$record.CommandLine).ToLowerInvariant()
    return $commandLine.Contains($supervisorPath.Replace("/", "\").ToLowerInvariant())
}

function Test-ProcessInTree([int] $rootProcessId, [int] $processId) {
    return @(Get-ProcessTree $rootProcessId | Where-Object { $_.ProcessId -eq $processId }).Count -gt 0
}

function Get-ProcessChain([int] $processId) {
    $records = @()
    while ($processId) {
        $record = Get-ProcessRecord $processId
        if (-not $record) { break }
        $records += $record
        if ($record.ParentProcessId -eq $record.ProcessId) { break }
        $processId = [int]$record.ParentProcessId
    }
    return $records
}

function Read-BridgeState {
    if (-not (Test-Path -LiteralPath $statePath)) { return $null }
    try {
        return Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
    } catch {
        Write-Host "Ignoring unreadable stale bridge state: $($_.Exception.Message)"
        return $null
    }
}

function Remove-BridgeState {
    if (Test-Path -LiteralPath $statePath) {
        Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
    }
}

function Stop-OwnedBridge([int] $rootProcessId) {
    $tree = @(Get-ProcessTree $rootProcessId)
    foreach ($record in ($tree | Sort-Object @{Expression={$_.ProcessId}; Descending=$true})) {
        Stop-Process -Id ([int]$record.ProcessId) -Force -ErrorAction SilentlyContinue
    }
}

function Get-PortListener {
    $listener = @(Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $expectedPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($listener.Count -eq 0) { return $null }
    return $listener[0]
}

function Try-RecoverStaleOwnedBridge($listener) {
    $state = Read-BridgeState
    if (Test-ActiveSupervisor $state) { return $false }
    $rootPid = $null
    if ($state -and $state.pid) {
        $candidatePid = [int]$state.pid
        $candidateRecord = Get-ProcessRecord $candidatePid
        if ((Test-ExpectedBridgeCommand $candidateRecord) -and
            (Test-ProcessInTree $candidatePid ([int]$listener.OwningProcess))) {
            $rootPid = $candidatePid
        }
    }
    if (-not $rootPid) {
        $candidate = Get-ProcessChain ([int]$listener.OwningProcess) |
            Where-Object { Test-ExpectedBridgeCommand $_ } |
            Select-Object -Last 1
        if ($candidate) { $rootPid = [int]$candidate.ProcessId }
    }
    if (-not $rootPid) { return $false }

    Write-Host "Recovering stale EasySD test bridge owned by PID $rootPid."
    Stop-OwnedBridge $rootPid
    Remove-BridgeState
    Start-Sleep -Milliseconds 500
    return $true
}

function Invoke-UxpCommand([string[]] $arguments, [int] $timeoutSeconds = 10) {
    $uxpCommand = (Get-Command uxp).Source
    $process = Start-Process -FilePath $uxpCommand -ArgumentList $arguments -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru
    if ($process.WaitForExit($timeoutSeconds * 1000)) {
        return $process.ExitCode
    }

    Write-Host "UXP command did not exit within $timeoutSeconds seconds; stopping its launcher-owned command tree."
    Stop-OwnedBridge $process.Id
    return 124
}

function Start-UxpService {
    $uxpCommand = (Get-Command uxp).Source
    Start-Process -FilePath $uxpCommand -ArgumentList @("service", "start") -WorkingDirectory $repoRoot -WindowStyle Hidden | Out-Null
}

$bridgeRootPid = $null
$cleanupState = $false

try {
    if (-not (Test-Path -LiteralPath $pythonPath)) {
        throw "Test bridge Python executable not found: $pythonPath"
    }
    if (-not (Test-Path -LiteralPath (Join-Path $repoRoot "local_server\main.py"))) {
        throw "local_server\main.py was not found under $repoRoot"
    }

    New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null

    try {
        $listener = Get-PortListener
    } catch {
        Write-Host "Port probe failed: $($_.Exception.Message)"
        exit 2
    }

    if ($listener) {
        if (-not (Try-RecoverStaleOwnedBridge $listener)) {
            $record = Get-ProcessRecord ([int]$listener.OwningProcess)
            $processName = if ($record) { $record.Name } else { "unknown" }
            $commandLine = if ($record) { [string]$record.CommandLine } else { "unavailable" }
            Write-Host "Port 8088 is already in use by PID $($listener.OwningProcess) ($processName)."
            Write-Host "Command line: $commandLine"
            exit 1
        }
        $listener = Get-PortListener
        if ($listener) {
            throw "Stale EasySD bridge cleanup did not free port 8088."
        }
    }

    $env:EASYSD_DEV_TEST_API = "1"
    $env:NODE_OPTIONS = "--openssl-legacy-provider"
    $bridge = Start-Process -FilePath $pythonPath -ArgumentList @(
        "-m", "uvicorn", "--app-dir=local_server", "main:app", "--port", "$expectedPort"
    ) -WorkingDirectory $repoRoot -PassThru
    $bridgeRootPid = $bridge.Id
    $cleanupState = $true

    [ordered]@{
        pid = $bridgeRootPid
        launcherPid = $PID
        repo = $repoRoot
        command = "venv\Scripts\python.exe -m uvicorn --app-dir=local_server main:app --port 8088"
        startedAt = (Get-Date).ToUniversalTime().ToString("o")
    } | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding ASCII

    Write-Host "Started EasySD test bridge with owned root PID $bridgeRootPid."
    Write-Host "Starting UXP service..."
    Start-UxpService

    Start-Sleep -Seconds 2
    Write-Host "Loading/reloading Photoshop plugin..."
    $manifestPath = Join-Path $repoRoot "dist\manifest.json"
    $loadExitCode = Invoke-UxpCommand @("plugin", "load", "--manifest", $manifestPath)
    if ($loadExitCode -eq 124) {
        throw "UXP plugin load timed out."
    }
    if ($loadExitCode -ne 0) {
        $reloadExitCode = Invoke-UxpCommand @("plugin", "reload", "--manifest", $manifestPath)
        if ($reloadExitCode -eq 124) {
            throw "UXP plugin reload timed out."
        }
        if ($reloadExitCode -ne 0) {
            throw "UXP plugin load and reload failed (load=$loadExitCode, reload=$reloadExitCode)."
        }
    }

    Write-Host ""
    Write-Host "TEST MODE READY"
    Write-Host "Bridge: http://127.0.0.1:8088"
    Write-Host "Dev health: http://127.0.0.1:8088/dev/photoshop/health"
    Write-Host "Press Enter to stop the owned test bridge."
    Read-Host | Out-Null
} catch {
    Write-Host "Test launcher failed: $($_.Exception.Message)"
    exit 2
} finally {
    if ($cleanupState -and $bridgeRootPid) {
        Write-Host "Stopping EasySD test bridge process tree rooted at PID $bridgeRootPid..."
        Stop-OwnedBridge $bridgeRootPid
        Remove-BridgeState
    }
}
