param([Parameter(Mandatory=$true)][string]$AppDirectory)
$ErrorActionPreference = 'Stop'
$originalPath = $env:Path
$scratch = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $scratch | Out-Null
try {
    foreach ($directory in @($AppDirectory, (Join-Path $AppDirectory 'llama.cpp'))) {
        foreach ($dll in @('vcruntime140.dll','vcruntime140_1.dll','msvcp140.dll')) {
            if (!(Test-Path (Join-Path $directory $dll))) { throw "Missing app-local CRT: $directory\$dll" }
        }
    }
    # Do not accidentally satisfy package dependencies from Git, OpenSSL,
    # Python or a build toolchain installed on the qualification machine.
    $env:Path = "$env:SystemRoot\System32;$env:SystemRoot"
    foreach ($relative in @('shadowcode.exe', 'llama.cpp\llama-server.exe', 'llama.cpp\llama-cli.exe')) {
        $exe = Join-Path $AppDirectory $relative
        if (!(Test-Path $exe)) { throw "Missing installed executable: $relative" }
        $stdout = Join-Path $scratch 'stdout.txt'
        $stderr = Join-Path $scratch 'stderr.txt'
        $process = Start-Process $exe -ArgumentList '--version' -PassThru -WorkingDirectory $scratch -RedirectStandardOutput $stdout -RedirectStandardError $stderr
        $handle = $process.Handle # Keep the process handle alive for ExitCode on Windows PowerShell 5.1.
        if (!$process.WaitForExit(60000)) {
            Stop-Process -Id $process.Id -Force
            throw "Version check timed out: $relative"
        }
        $process.Refresh()
        $output = (Get-Content $stdout,$stderr -Raw -ErrorAction SilentlyContinue) -join "`n"
        if ($process.ExitCode -ne 0) { throw "$relative exited $($process.ExitCode): $output" }
        if ($output -notmatch '(?i)version|ShadowCode') { throw "$relative produced no version: $output" }
        Write-Output "PASS $relative"
        Write-Output $output
    }
    # --version exits during argument parsing. Exercise the async CLI too:
    # a debug build can pass --version but overflow Windows' default stack.
    $arguments = @('--profile', "`"$scratch\profile`"", '--workspace', "`"$scratch`"", 'status')
    $process = Start-Process (Join-Path $AppDirectory 'shadowcode.exe') -ArgumentList $arguments -PassThru -WorkingDirectory $scratch -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    $handle = $process.Handle
    if (!$process.WaitForExit(60000)) {
        Stop-Process -Id $process.Id -Force
        throw 'Installed CLI status timed out'
    }
    $process.Refresh()
    if ($process.ExitCode -ne 0) {
        $output = (Get-Content $stdout,$stderr -Raw -ErrorAction SilentlyContinue) -join "`n"
        throw "Installed CLI status exited $($process.ExitCode): $output"
    }
    Write-Output 'PASS shadowcode.exe status (isolated profile)'
} finally {
    $env:Path = $originalPath
    Remove-Item $scratch -Recurse -Force
}
