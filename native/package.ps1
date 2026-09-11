# Distribution script for the native monitor; GPL-3.0-or-later (see LICENSE).
param([string]$CacheDirectory)
$ErrorActionPreference = 'Stop'
function Get-Sha256([string]$file) {
    $stream = [IO.File]::OpenRead($file)
    $hash = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-','').ToLowerInvariant() }
    finally { $hash.Dispose(); $stream.Dispose() }
}
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $CacheDirectory) { $CacheDirectory = Join-Path $projectRoot '.runtime\distribution-cache' }
$CacheDirectory = [IO.Path]::GetFullPath($CacheDirectory)
New-Item -ItemType Directory -Force -Path $CacheDirectory | Out-Null
$inputs = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'distribution-inputs.json') -Raw | ConvertFrom-Json
foreach ($inputFile in $inputs) {
    $cachedFile = Join-Path $CacheDirectory $inputFile.file
    if (-not (Test-Path -LiteralPath $cachedFile)) {
        Write-Output "Downloading $($inputFile.file)"
        & curl.exe -fL --retry 2 --max-time 180 -o $cachedFile $inputFile.url
        if ($LASTEXITCODE -ne 0) { throw "Download failed: $($inputFile.file)" }
    }
    if ((Get-Sha256 $cachedFile) -ne $inputFile.sha256) {
        throw "SHA-256 mismatch: $($inputFile.file). No package was published."
    }
}

# Fresh staging directory: never copy the worktree or user .runtime wholesale.
$staging = Join-Path $projectRoot ('.runtime\package-' + [Guid]::NewGuid().ToString('N'))
$package = Join-Path $staging 'LiveMultiviewer'
$runtime = Join-Path $package 'runtime\obs'
$source = Join-Path $package 'source'
foreach ($directory in @($runtime, $source, (Join-Path $source 'native'), (Join-Path $source 'upstream'), (Join-Path $package 'licenses'))) {
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$runtimeFiles = @('obs.dll','libobs-d3d11.dll','w32-pthreads.dll','avcodec-62.dll','avdevice-62.dll',
    'avfilter-11.dll','avformat-62.dll','avutil-60.dll','swscale-9.dll','swresample-6.dll',
    'librist.dll','srt.dll','libx264-164.dll','zlib.dll')
function Extract-Entry($entry, [string]$directory, [string]$relative) {
    if (-not $entry.Name) { return }
    $targetPath = [IO.Path]::GetFullPath((Join-Path $directory $relative))
    $allowedRoot = [IO.Path]::GetFullPath($directory).TrimEnd('\') + '\'
    if (-not $targetPath.StartsWith($allowedRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe archive path.' }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $targetPath) | Out-Null
    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $targetPath)
}
$archive = [IO.Compression.ZipFile]::OpenRead((Join-Path $CacheDirectory 'OBS-Studio-32.2.1-Windows-x64.zip'))
try {
    foreach ($entry in $archive.Entries) {
        $path = $entry.FullName
        if (($path.StartsWith('bin/64bit/') -and $runtimeFiles -contains $entry.Name) -or
            $path -eq 'obs-plugins/64bit/obs-ffmpeg.dll' -or
            $path.StartsWith('data/libobs/') -or $path.StartsWith('data/obs-plugins/obs-ffmpeg/')) {
            Extract-Entry $entry $runtime $path
        }
        if ($path.StartsWith('data/obs-studio/license/')) {
            Extract-Entry $entry (Join-Path $package 'licenses') ('OBS/' + $entry.Name)
        }
    }
} finally { $archive.Dispose() }
foreach ($dll in $runtimeFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $runtime "bin\64bit\$dll"))) { throw "Missing runtime: $dll" }
}
$archive = [IO.Compression.ZipFile]::OpenRead((Join-Path $CacheDirectory 'windows-deps-2026-07-15-x64.zip'))
try {
    foreach ($entry in $archive.Entries) {
        if ($entry.FullName.StartsWith('licenses/')) { Extract-Entry $entry $package $entry.FullName }
    }
} finally { $archive.Dispose() }

& (Join-Path $PSScriptRoot 'build.ps1') -ObsRoot $runtime
Copy-Item -LiteralPath (Join-Path $projectRoot '.runtime\native\LiveMultiviewer.exe') -Destination $package
Get-ChildItem -LiteralPath $PSScriptRoot -File | Where-Object { $_.Extension -in '.cs','.ps1','.json' -or $_.Name -in 'LICENSE','NOTICE','DISTRIBUTION.md' } | Copy-Item -Destination (Join-Path $source 'native')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'distribution-inputs.json') -Destination (Join-Path $source 'inputs.json')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'DISTRIBUTION.md') -Destination (Join-Path $package 'README.md')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'NOTICE') -Destination $package
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'LICENSE') -Destination $package
foreach ($inputFile in $inputs | Where-Object { $_.role -eq 'source' }) {
    Copy-Item -LiteralPath (Join-Path $CacheDirectory $inputFile.file) -Destination (Join-Path $source 'upstream')
}
$ascii = [Text.Encoding]::ASCII
[IO.File]::WriteAllText((Join-Path $package 'self-test.cmd'), "@echo off`r`n`"%~dp0LiveMultiviewer.exe`" --self-test`r`nif errorlevel 1 (echo SELF-TEST FAILED) else (echo SELF-TEST PASSED)`r`npause`r`n", $ascii)
[IO.File]::WriteAllText((Join-Path $source 'rebuild.cmd'), "@echo off`r`npowershell.exe -NoProfile -ExecutionPolicy Bypass -File `"%~dp0native\build.ps1`" -ObsRoot `"%~dp0..\runtime\obs`"`r`npause`r`n", $ascii)
[IO.File]::WriteAllText((Join-Path $package 'Microsoft-VC-Runtime.url'), "[InternetShortcut]`r`nURL=https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist`r`n", $ascii)

# Verification output belongs in the build workspace, never in the shareable ZIP.
$testOutput = Join-Path $staging 'verification'
& (Join-Path $package 'LiveMultiviewer.exe') --self-test --project-root $testOutput
if ($LASTEXITCODE -ne 0) { throw 'Bundled-runtime self-test failed. No package was published.' }
$forbidden = Get-ChildItem -LiteralPath $package -Recurse -Force | Where-Object {
    $_.Name -in '.runtime','.git','.env','settings.json','native-settings.dat','native-events.dat' -or $_.Extension -in '.log','.pdb'
}
if ($forbidden) { throw 'Unexpected private/generated files in staging.' }
$hashes = Get-ChildItem -LiteralPath $package -Recurse -File | Sort-Object FullName | ForEach-Object {
    (Get-Sha256 $_.FullName) + '  ' + $_.FullName.Substring($package.Length + 1).Replace('\','/')
}
[IO.File]::WriteAllLines((Join-Path $package 'SHA256SUMS.txt'), $hashes, (New-Object Text.UTF8Encoding($false)))
# Vite clears dist during a web build. Keep portable deliverables separate.
$outputDirectory = Join-Path $projectRoot 'releases'
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
$zip = Join-Path $outputDirectory ('LiveMultiviewer-0.1.0-preview-win-x64-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.zip')
[IO.Compression.ZipFile]::CreateFromDirectory($package, $zip, [IO.Compression.CompressionLevel]::Optimal, $true)
[IO.File]::WriteAllText(($zip + '.sha256'), (Get-Sha256 $zip) + '  ' + [IO.Path]::GetFileName($zip) + "`r`n", $ascii)
Write-Output "Package: $zip"
Write-Output ('Size: {0:N1} MB' -f ((Get-Item -LiteralPath $zip).Length / 1MB))
