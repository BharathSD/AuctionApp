$ErrorActionPreference = 'Stop'

try {
  if (-not (Test-Path ".git")) {
    Write-Host "[hook-precheck] No git repository detected; skipping precheck."
    exit 0
  }

  $changedFiles = git diff --name-only --cached
  git diff --name-only | ForEach-Object { $changedFiles += $_ }
  $changedFiles = $changedFiles | Where-Object { $_ -and $_.Trim().Length -gt 0 } | Select-Object -Unique

  if (-not $changedFiles -or $changedFiles.Count -eq 0) {
    Write-Host "[hook-precheck] No changed files yet."
    exit 0
  }

  $clientTouched = $false
  $serverTouched = $false

  foreach ($file in $changedFiles) {
    $normalized = $file.Replace('\\', '/').ToLowerInvariant()
    if ($normalized.StartsWith('client/') -and -not $normalized.StartsWith('client/node_modules/') -and -not $normalized.StartsWith('client/dist/')) {
      $clientTouched = $true
    }
    if ($normalized.StartsWith('server/') -and -not $normalized.StartsWith('server/node_modules/') -and -not $normalized.StartsWith('server/coverage/')) {
      $serverTouched = $true
    }
  }

  if ($clientTouched -or $serverTouched) {
    Write-Host "[hook-precheck] Build/test gate will run on stop because app code changes are detected."
  }
  else {
    Write-Host "[hook-precheck] No app code changes detected for client/server."
  }

  exit 0
}
catch {
  Write-Warning "[hook-precheck] Precheck warning: $($_.Exception.Message)"
  exit 0
}
