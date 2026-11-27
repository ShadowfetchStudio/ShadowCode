# Local selection must fail before networking or launching any installer.
$ErrorActionPreference = 'Stop'
$dir = Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString('N'))
$oldVersion = $env:SHADOWCODE_VERSION
$oldLocal = $env:SHADOWCODE_SETUP_DIR
try {
    New-Item -ItemType Directory -Path $dir | Out-Null
    $env:SHADOWCODE_SETUP_DIR = $dir
    $env:SHADOWCODE_VERSION = ''
    foreach ($version in @('1.0.0', '2.0.0')) {
        New-Item -ItemType File -Path (Join-Path $dir "ShadowCode_${version}_x64-setup.exe") | Out-Null
    }
    try {
        & "$PSScriptRoot/install-windows.ps1"
        throw 'Installer accepted an ambiguous directory.'
    } catch {
        if ($_.Exception.Message -notlike 'ShadowCode installer: set SHADOWCODE_VERSION*') { throw }
    }
} finally {
    $env:SHADOWCODE_VERSION = $oldVersion
    $env:SHADOWCODE_SETUP_DIR = $oldLocal
    Remove-Item -LiteralPath $dir -Recurse -Force
}
