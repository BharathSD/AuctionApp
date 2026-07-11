$ErrorActionPreference = 'Stop'

function Invoke-Step {
  param(
    [string]$Name,
    [string]$Command,
    [string[]]$Arguments = @(),
    [int]$TimeoutSeconds = 600
  )

  Write-Host "[hook] Running: $Name"
  $processInfo = New-Object System.Diagnostics.ProcessStartInfo
  $processInfo.FileName = $Command
  foreach ($arg in $Arguments) {
    [void]$processInfo.ArgumentList.Add($arg)
  }
  $processInfo.RedirectStandardOutput = $true
  $processInfo.RedirectStandardError = $true
  $processInfo.UseShellExecute = $false
  $processInfo.CreateNoWindow = $true

  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $processInfo
  $null = $process.Start()

  if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
    $process.Kill($true)
    throw "Step timed out after $TimeoutSeconds seconds: $Name"
  }

  $stdout = $process.StandardOutput.ReadToEnd()
  $stderr = $process.StandardError.ReadToEnd()
  if ($stdout) { Write-Host $stdout }
  if ($stderr) { Write-Error $stderr }

  if ($process.ExitCode -ne 0) {
    throw "Step failed: $Name (exit code $($process.ExitCode))"
  }
}

function Is-RelevantCodeFile {
  param([string]$Path)

  if (-not $Path) { return $false }
  $normalized = $Path.Replace('\\', '/').ToLowerInvariant()
  if ($normalized.StartsWith('client/node_modules/') -or $normalized.StartsWith('server/node_modules/')) { return $false }
  if ($normalized.StartsWith('client/dist/')) { return $false }
  if ($normalized.StartsWith('server/coverage/') -or $normalized.StartsWith('client/coverage/')) { return $false }

  $ext = [System.IO.Path]::GetExtension($normalized)
  $allowed = @('.js', '.jsx', '.ts', '.tsx', '.json', '.css', '.html')
  return $allowed -contains $ext
}

try {
  if (-not (Test-Path ".git")) {
    Write-Host "[hook] No git repository detected; skipping quality gate."
    exit 0
  }

  $npmCommand = "npm"
  $localNpm = Join-Path (Get-Location) "node-v24.16.0-win-x64\\npm.cmd"
  if (Test-Path $localNpm) {
    $npmCommand = $localNpm
  }

  $changedFiles = git diff --name-only --cached
  git diff --name-only | ForEach-Object { $changedFiles += $_ }
  $changedFiles = $changedFiles | Where-Object { $_ -and $_.Trim().Length -gt 0 } | Select-Object -Unique

  if (-not $changedFiles -or $changedFiles.Count -eq 0) {
    Write-Host "[hook] No changed files detected; skipping quality gate."
    exit 0
  }

  $clientTouched = $false
  $serverTouched = $false

  foreach ($file in $changedFiles) {
    if (-not (Is-RelevantCodeFile -Path $file)) {
      continue
    }

    if ($file -like "client/*" -or $file -like "client\\*") {
      $clientTouched = $true
    }
    if ($file -like "server/*" -or $file -like "server\\*") {
      $serverTouched = $true
    }
  }

  if ($clientTouched) {
    Invoke-Step -Name "Client tests" -Command $npmCommand -Arguments @("run", "test", "--prefix", "client") -TimeoutSeconds 600
    Invoke-Step -Name "Client build" -Command $npmCommand -Arguments @("run", "build", "--prefix", "client") -TimeoutSeconds 900
  }

  if ($serverTouched) {
    Invoke-Step -Name "Server tests" -Command $npmCommand -Arguments @("run", "test", "--prefix", "server") -TimeoutSeconds 600
  }

  if (-not $clientTouched -and -not $serverTouched) {
    Write-Host "[hook] No relevant client/server code changes detected; no build/test gates run."
  }

  Write-Host "[hook] Quality gate passed."
  exit 0
}
catch {
  Write-Error "[hook] Quality gate failed: $($_.Exception.Message)"
  exit 2
}
