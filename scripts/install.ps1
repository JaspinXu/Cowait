# Install or update Cowait (standalone binary, no Node needed) on Windows. No admin rights needed:
#
#   irm https://github.com/JaspinXu/Cowait/releases/latest/download/install.ps1 | iex
#
# Running it again updates in place. Settings (environment variables):
#   COWAIT_VERSION=0.3.0        install that release instead of the latest
#   COWAIT_INSTALL_DIR=<dir>    where cowait.exe goes (default: %LOCALAPPDATA%\Programs\cowait)
#   COWAIT_DOWNLOAD_URL=<url>   base URL of the release files (mirrors, testing)
#   COWAIT_NO_MODIFY_PATH=1     do not add the folder to your user PATH
#
# Works in Windows PowerShell 5.1 and PowerShell 7. Everything runs inside one script block so
# nothing leaks into your session when it is piped to iex.

& {
  $ErrorActionPreference = 'Stop'
  # Invoke-WebRequest's progress bar slows PowerShell 5.1 downloads down by an order of magnitude.
  $ProgressPreference = 'SilentlyContinue'
  # GitHub requires TLS 1.2, which Windows PowerShell 5.1 does not always enable by default.
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

  $repo = 'JaspinXu/Cowait'
  if (-not [Environment]::Is64BitOperatingSystem) { throw 'Cowait needs 64-bit Windows.' }
  # One x64 build: Windows 11 on ARM runs it through its x64 emulation.
  $asset = 'cowait-windows-x64.exe'

  if ($env:COWAIT_DOWNLOAD_URL) { $base = $env:COWAIT_DOWNLOAD_URL.TrimEnd('/') }
  elseif ($env:COWAIT_VERSION) { $base = "https://github.com/$repo/releases/download/v$($env:COWAIT_VERSION.TrimStart('v'))" }
  else { $base = "https://github.com/$repo/releases/latest/download" }

  if ($env:COWAIT_INSTALL_DIR) { $dir = $env:COWAIT_INSTALL_DIR } else { $dir = Join-Path $env:LOCALAPPDATA 'Programs\cowait' }
  $dir = [IO.Path]::GetFullPath($dir)
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $exe = Join-Path $dir 'cowait.exe'
  $tmp = Join-Path $dir 'cowait.download.exe'
  $sums = Join-Path $dir 'SHA256SUMS.download'

  try {
    Write-Host "Downloading $asset from $base"
    Invoke-WebRequest -UseBasicParsing -Uri "$base/$asset" -OutFile $tmp
    Invoke-WebRequest -UseBasicParsing -Uri "$base/SHA256SUMS" -OutFile $sums

    $expected = $null
    foreach ($line in Get-Content -LiteralPath $sums) {
      if ($line -match '^([0-9a-fA-F]{64})\s+\*?(\S+)\s*$' -and $Matches[2] -eq $asset) { $expected = $Matches[1].ToLowerInvariant() }
    }
    if (-not $expected) { throw "SHA256SUMS has no entry for $asset" }
    $actual = (Get-FileHash -LiteralPath $tmp -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expected) { throw "Checksum mismatch for $asset (expected $expected, got $actual)" }

    # A running cowait.exe (the panel, or a hook call in progress) cannot be overwritten, but it can be renamed.
    if (Test-Path -LiteralPath $exe) {
      try { Remove-Item -LiteralPath $exe -Force }
      catch { Move-Item -LiteralPath $exe -Destination (Join-Path $dir ('cowait.old-{0}.exe' -f [DateTime]::UtcNow.Ticks)) -Force }
    }
    Move-Item -LiteralPath $tmp -Destination $exe
  }
  finally {
    Remove-Item -LiteralPath $tmp, $sums -Force -ErrorAction SilentlyContinue
  }
  # Copies renamed by earlier updates go once nothing runs them any more.
  Get-ChildItem -LiteralPath $dir -Filter 'cowait.old-*.exe' | ForEach-Object {
    try { Remove-Item -LiteralPath $_.FullName -Force } catch { }
  }

  $version = & $exe --version
  if ($LASTEXITCODE -ne 0) { throw "Installed $exe, but it does not run on this system." }
  Write-Host "Cowait $version installed: $exe (checksum verified)"

  # Add the folder to the user PATH (no admin). Read and write the raw registry value so entries
  # like %USERPROFILE%\bin stay unexpanded and the value keeps its REG_EXPAND_SZ type.
  $samePath = { param($a, $b) $a.Trim().TrimEnd('\') -ieq $b.TrimEnd('\') }
  $pathAdded = $false
  if (-not $env:COWAIT_NO_MODIFY_PATH) {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
    try {
      $raw = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
      $entries = @($raw -split ';' | Where-Object { $_ })
      $present = @($entries | Where-Object { & $samePath ([Environment]::ExpandEnvironmentVariables($_)) $dir }).Count -gt 0
      if (-not $present) {
        $kind = [Microsoft.Win32.RegistryValueKind]::ExpandString
        if ($raw) { $kind = $key.GetValueKind('Path') }
        $key.SetValue('Path', (($entries + $dir) -join ';'), $kind)
        $pathAdded = $true
        # Tell running programs (Explorer, new terminals) that the environment changed.
        [Environment]::SetEnvironmentVariable('COWAIT_INSTALLER', '1', 'User')
        [Environment]::SetEnvironmentVariable('COWAIT_INSTALLER', $null, 'User')
      }
    }
    finally { $key.Close() }
  }
  # This session too, so `cowait` works right away.
  if (-not @($env:Path -split ';' | Where-Object { $_ -and (& $samePath $_ $dir) }).Count) { $env:Path = "$env:Path;$dir" }

  Write-Host ''
  if ($pathAdded) { Write-Host "Added $dir to your user PATH (terminals opened from now on will find cowait)." }
  elseif ($env:COWAIT_NO_MODIFY_PATH) { Write-Host "Not changing PATH (COWAIT_NO_MODIFY_PATH). Run it as: & '$exe'" }
  Write-Host 'Next:'
  Write-Host '  cowait install     hook Cowait into Claude Code (or: cowait install --project, for one project)'
  Write-Host '  cowait split       open the panel next to Claude Code (Windows Terminal), or run cowait in another pane'
}
