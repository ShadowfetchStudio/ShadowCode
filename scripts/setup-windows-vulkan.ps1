# The pinned LunarG SDK supplies glslc and the Vulkan import library, only on the build runner.
$ErrorActionPreference = 'Stop'
$version = '1.4.363.0'
$installer = Join-Path $env:RUNNER_TEMP 'shadowcode-vulkan-sdk.exe'
$sdk = "C:\VulkanSDK\$version"
$url = "https://sdk.lunarg.com/sdk/download/$version/windows/vulkansdk-windows-X64-$version.exe"
Invoke-WebRequest -Uri $url -OutFile $installer
# microsoft/winget-pkgs, KhronosGroup.VulkanSDK 1.4.363.0, x64
if ((Get-FileHash $installer -Algorithm SHA256).Hash -ne '94A82D378F7A5E3E54C9DB7D2FB7016AF136E14AC0A18DBF0F2F67A36352D141') {
    throw 'Unexpected Vulkan SDK installer digest'
}
$setup = Start-Process $installer -ArgumentList '--accept-licenses','--default-answer','--confirm-command','install' -Wait -PassThru
if ($setup.ExitCode -ne 0 -or !(Test-Path "$sdk\Bin\glslc.exe")) { throw 'Vulkan SDK installation failed' }
"VULKAN_SDK=$sdk" | Out-File -FilePath $env:GITHUB_ENV -Encoding utf8 -Append
"$sdk\Bin" | Out-File -FilePath $env:GITHUB_PATH -Encoding utf8 -Append
