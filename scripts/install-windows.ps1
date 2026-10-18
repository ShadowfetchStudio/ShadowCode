# Install or update ShadowCode on Windows from its GitHub release. In
# PowerShell:
#
#   irm https://raw.githubusercontent.com/ShadowfetchStudio/ShadowCode/main/scripts/install-windows.ps1 | iex
#
#   * Downloads ShadowCode_<version>_x64-setup.exe and the release's
#     ShadowCode_<version>_windows.sha256, and refuses the installer unless
#     its SHA-256 matches.
#   * Runs it for the current user only (no administrator rights): the app
#     goes to %LOCALAPPDATA%\ShadowCode, replacing an earlier version.
#     Settings stay in %APPDATA%\ShadowCode and history in
#     %LOCALAPPDATA%\ShadowCode, and are kept.
#   * Adds that folder to your user PATH for the shadowcode command.
#   * The installer is not code-signed. Files fetched by PowerShell are not
#     marked as downloaded, so Windows runs it without the SmartScreen
#     prompt; an installer downloaded in a browser shows "Windows protected
#     your PC" once instead (More info > Run anyway).
#
# Environment: SHADOWCODE_VERSION (default: the latest release).
# SHADOWCODE_SETUP_DIR uses an installer and checksum file from that folder
# instead of downloading them (for testing a build).
$ErrorActionPreference = 'Stop'
$Repo = 'ShadowfetchStudio/ShadowCode'
# Throw rather than exit: under `irm | iex`, exit would close the window.
function Fail([string]$Message) { throw "ShadowCode installer: $Message" }
if (-not [Environment]::Is64BitOperatingSystem) { Fail 'ShadowCode needs 64-bit Windows.' }
# Windows PowerShell 5.1 does not offer TLS 1.2 by default.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$Version = $env:SHADOWCODE_VERSION
$Local = $env:SHADOWCODE_SETUP_DIR
if (-not $Version -and $Local) {
    $found = Get-ChildItem -Path $Local -Filter 'ShadowCode_*_x64-setup.exe' | Select-Object -First 1
    if ($found -and $found.Name -match '^ShadowCode_(.+)_x64-setup\.exe$') { $Version = $Matches[1] }
}
if (-not $Version) {
    # The latest release's page redirects to its tag; no API token needed.
    $request = [Net.HttpWebRequest]::Create("https://github.com/$Repo/releases/latest")
    $request.AllowAutoRedirect = $false
    $request.Method = 'HEAD'
    $response = $request.GetResponse()
    $location = $response.Headers['Location']
    $response.Close()
    if ($location -match '/tag/v([^/]+)$') { $Version = $Matches[1] }
}
if ($Version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$') { Fail "could not tell which version to install (got '$Version')." }

$Setup = "ShadowCode_${Version}_x64-setup.exe"
$Sums = "ShadowCode_${Version}_windows.sha256"
$Base = "https://github.com/$Repo/releases/download/v$Version"
$Work = Join-Path ([IO.Path]::GetTempPath()) ("shadowcode-install-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Work | Out-Null
try {
    if ($Local) {
        Copy-Item -LiteralPath (Join-Path $Local $Sums) -Destination $Work
        Copy-Item -LiteralPath (Join-Path $Local $Setup) -Destination $Work
    } else {
        Write-Host "Downloading ShadowCode $Version for Windows..."
        $ProgressPreference = 'SilentlyContinue'
        try { Invoke-WebRequest -UseBasicParsing -Uri "$Base/$Sums" -OutFile (Join-Path $Work $Sums) }
        catch { Fail "release v$Version has no Windows checksums ($Sums)." }
        try { Invoke-WebRequest -UseBasicParsing -Uri "$Base/$Setup" -OutFile (Join-Path $Work $Setup) }
        catch { Fail "release v$Version has no $Setup." }
    }
    $expected = $null
    foreach ($line in Get-Content -LiteralPath (Join-Path $Work $Sums)) {
        $parts = $line -split '\s+', 2
        if ($parts.Count -eq 2 -and $parts[1].TrimStart('*') -eq $Setup) { $expected = $parts[0].ToLowerInvariant() }
    }
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $Work $Setup)).Hash.ToLowerInvariant()
    if ($expected -notmatch '^[0-9a-f]{64}$' -or $expected -ne $actual) {
        Fail "$Setup does not match the release's checksum; nothing was installed."
    }

    $App = Join-Path $env:LOCALAPPDATA 'ShadowCode'
    $running = Get-Process -Name 'shadowcode' -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -and $_.Path.StartsWith($App, [StringComparison]::OrdinalIgnoreCase) }
    if ($running) { Fail 'ShadowCode is running; close it and run the installer again.' }

    Write-Host "Installing ShadowCode $Version..."
    $process = Start-Process -FilePath (Join-Path $Work $Setup) -ArgumentList '/S' -Wait -PassThru
    if ($process.ExitCode -ne 0) { Fail "the installer stopped with code $($process.ExitCode)." }
    $exe = Join-Path $App 'shadowcode.exe'
    if (-not (Test-Path -LiteralPath $exe)) { Fail "the installer finished, but $exe is missing." }

    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $entries = @($userPath -split ';' | Where-Object { $_ })
    if (-not ($entries | Where-Object { $_.TrimEnd('\') -ieq $App })) {
        [Environment]::SetEnvironmentVariable('Path', (($entries + $App) -join ';'), 'User')
        Write-Host "Added $App to your PATH; open a new terminal for the shadowcode command."
    }
    Write-Host "Installed ShadowCode $Version in $App."
    Write-Host 'Open it from the Start menu (ShadowCode).'
} finally {
    Remove-Item -LiteralPath $Work -Recurse -Force -ErrorAction SilentlyContinue
}
