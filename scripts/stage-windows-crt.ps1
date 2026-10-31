# Stage Microsoft's app-local redistributable CRT, not DLLs from System32.
# Both the desktop executable and the separately launched model runtime need it.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vs = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (!$vs) { throw 'Visual Studio C++ build tools are required to stage the redistributable CRT.' }
$redist = Get-ChildItem (Join-Path $vs 'VC\Redist\MSVC') -Directory |
    Where-Object { $_.Name -match '^\d+\.\d+\.\d+$' } |
    Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
if (!$redist) { throw 'MSVC redistributable directory was not found.' }
$crt = Get-ChildItem (Join-Path $redist.FullName 'x64') -Directory -Filter 'Microsoft.VC*.CRT' | Select-Object -First 1
if (!$crt) { throw 'The x64 Microsoft CRT redistributables were not found.' }
$files = @(Get-ChildItem $crt.FullName -File -Filter '*.dll')
foreach ($required in @('vcruntime140.dll','vcruntime140_1.dll','msvcp140.dll')) {
    if ($files.Name -notcontains $required) { throw "Missing redistributable: $required" }
}
$dest = Join-Path $root 'packaging\windows\crt'
$runtime = Join-Path $root 'packaging\llama.cpp\bin'
if (!(Test-Path (Join-Path $runtime 'llama-server.exe'))) { throw 'Build the managed runtime before staging its CRT.' }
New-Item -ItemType Directory -Force $dest | Out-Null
foreach ($file in $files) {
    Copy-Item $file.FullName $dest -Force
    Copy-Item $file.FullName $runtime -Force
}
Write-Output "Staged x64 CRT $($redist.Name) for the desktop and managed runtime."
