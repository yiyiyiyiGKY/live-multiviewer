param([switch]$Run, [switch]$Test, [string]$ObsRoot = $env:OBS_ROOT)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $ObsRoot) {
    $candidates = @('D:\obs-studio', "$env:ProgramFiles\obs-studio")
    $ObsRoot = $candidates | Where-Object { Test-Path -LiteralPath (Join-Path $_ 'bin\64bit\obs.dll') } | Select-Object -First 1
}
if (-not $ObsRoot -or -not (Test-Path -LiteralPath (Join-Path $ObsRoot 'bin\64bit\obs.dll'))) {
    throw 'OBS 32.2.x x64 not found. Set OBS_ROOT to its installation directory.'
}
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw 'Windows .NET Framework 4.x x64 compiler is required.' }
$outputDirectory = Join-Path $projectRoot '.runtime\native'
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
$executable = Join-Path $outputDirectory 'LiveMultiviewer.exe'
$sources = @(Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.cs' | Select-Object -ExpandProperty FullName)
& $compiler /nologo /target:exe /platform:x64 /optimize+ /warnaserror+ /utf8output /codepage:65001 "/out:$executable" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll /reference:System.Security.dll @sources
if ($LASTEXITCODE -ne 0) { throw 'Native monitor build failed.' }
Write-Output "Built: $executable"
if ($Run -or $Test) {
    $arguments = @('--obs-root', $ObsRoot, '--project-root', $projectRoot)
    if ($Test) { $arguments += '--self-test' }
    & $executable @arguments
    exit $LASTEXITCODE
}
