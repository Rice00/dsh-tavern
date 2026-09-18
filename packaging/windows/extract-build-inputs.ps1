param(
    [Parameter(Mandatory=$true)][string]$Launcher,
    [Parameter(Mandatory=$true)][string]$Destination
)
$ErrorActionPreference = 'Stop'
$Launcher = (Resolve-Path -LiteralPath $Launcher).Path
$Destination = [IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Force $Destination | Out-Null
# Read embedded resources only; do not run the downloaded launcher's entry point.
$assembly = [Reflection.Assembly]::LoadFile($Launcher)
foreach ($item in @(@('payload','online-payload.7z'), @('seven','7za.exe'))) {
    $stream = $assembly.GetManifestResourceStream($item[0])
    if ($null -eq $stream) { throw "Missing launcher resource: $($item[0])" }
    try {
        $file = [IO.File]::Create((Join-Path $Destination $item[1]))
        try { $stream.CopyTo($file) } finally { $file.Dispose() }
    } finally { $stream.Dispose() }
}
$expected = '5e2e365397638d61f202753b5dbcee1d9dbd377a5a9d17c160535891f187decd'
if ((Get-FileHash -LiteralPath (Join-Path $Destination 'online-payload.7z')).Hash.ToLowerInvariant() -ne $expected) { throw 'Unexpected Desktop payload' }
Write-Output "Verified build inputs: $Destination"
