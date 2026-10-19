param(
    [ValidateSet('Prepare', 'Restore')][string]$Mode,
    [string]$InstallDir,
    [string]$RegisteredInstallDir,
    [string]$RegisteredDataDir,
    [string]$CurrentUserInstallDir,
    [string]$CurrentUserDataDir,
    [string]$LegacyProfileDir = ([IO.Path]::Combine([Environment]::GetFolderPath('ApplicationData'), 'infinite-canvas')),
    [string]$StatePath,
    [string]$BackupRoot,
    [string]$ResolvedPath
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$utf8 = New-Object System.Text.UTF8Encoding($false)
$strictUtf8 = New-Object System.Text.UTF8Encoding($false, $true)
$items = @('IndexedDB', 'Local Storage', 'Session Storage', 'WebStorage', 'blob_storage', 'Partitions', 'canvas-data', 'input', 'output', 'Preferences', 'Local State', '.infinite-canvas-userdata', 'io-paths.txt', 'canvas-backups')

function FullPath([string]$value) {
    if ([string]::IsNullOrWhiteSpace($value) -or -not [IO.Path]::IsPathRooted($value)) { throw 'Data path must be absolute.' }
    $full = [IO.Path]::GetFullPath($value)
    if ($full.TrimEnd('\') -eq [IO.Path]::GetPathRoot($full).TrimEnd('\')) { throw 'A drive root cannot be an application data directory.' }
    return $full.TrimEnd('\')
}
function Inside([string]$candidate, [string]$directory) {
    return $candidate.StartsWith($directory.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)
}
function ReadPointer([string]$directory) {
    if ([string]::IsNullOrWhiteSpace($directory)) { return '' }
    $file = Join-Path $directory 'data-dir.txt'
    if (-not (Test-Path -LiteralPath $file)) { return '' }
    try { $value = [IO.File]::ReadAllText($file, $strictUtf8).Trim() }
    catch [Text.DecoderFallbackException] { $value = [IO.File]::ReadAllText($file, [Text.Encoding]::Default).Trim() }
    return FullPath $value
}
function HasData([string]$directory) {
    if ([string]::IsNullOrWhiteSpace($directory)) { return $false }
    foreach ($name in @('IndexedDB', 'Local Storage', 'canvas-data', 'input', 'output', 'blob_storage', 'Preferences', '.infinite-canvas-userdata')) {
        if (Test-Path -LiteralPath (Join-Path $directory $name)) { return $true }
    }
    return $false
}
function SourceFiles([string]$directory) {
    foreach ($name in $items) {
        $item = Join-Path $directory $name
        if (-not (Test-Path -LiteralPath $item)) { continue }
        $rootEntry = Get-Item -LiteralPath $item -Force
        if (($rootEntry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Linked data directory requires manual backup: $item" }
        if ($rootEntry.PSIsContainer) {
            $children = @(Get-ChildItem -LiteralPath $item -Force -Recurse)
            if (@($children | Where-Object { ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 }).Count) { throw "Linked files require manual backup: $item" }
            $children | Where-Object { -not $_.PSIsContainer }
        } else { $rootEntry }
    }
}
function CopyVerified([string]$source, [string]$destination, [string]$expectedHash) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination -Force
    if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -ne $expectedHash) { throw "Backup verification failed: $destination" }
}

try {
    $install = FullPath $InstallDir
    if ($Mode -eq 'Prepare') {
        # Never copy an open Chromium database, and never force-kill the app.
        if (@(Get-Process -Name 'InfiniteCanvas' -ErrorAction SilentlyContinue).Count) { throw 'Close InfiniteCanvas completely, then run the installer again.' }
        $registeredPointer = ReadPointer $RegisteredInstallDir
        $targetPointer = ReadPointer $install
        $userPointer = ReadPointer $CurrentUserInstallDir
        foreach ($registeredPath in @($registeredPointer, $targetPointer, $RegisteredDataDir, $userPointer, $CurrentUserDataDir)) {
            if ($registeredPath -and -not (Test-Path -LiteralPath $registeredPath -PathType Container)) { throw "Registered data directory is missing: $registeredPath" }
        }
        $primary = if ($registeredPointer) { $registeredPointer } elseif ($RegisteredDataDir) { FullPath $RegisteredDataDir } elseif ($targetPointer) { $targetPointer } else { '' }
        if ($primary -and -not (Test-Path -LiteralPath $primary -PathType Container)) { throw "Registered data directory is missing: $primary" }
        $defaultProfile = $LegacyProfileDir
        $targetData = Join-Path $install 'data'
        $productProfile = Join-Path (Split-Path -Parent $defaultProfile) 'InfiniteCanvas'
        $candidates = @($primary, $targetPointer, $targetData, $defaultProfile, $productProfile)
        if ($RegisteredInstallDir) { $candidates += Join-Path $RegisteredInstallDir 'data' }
        if ($CurrentUserInstallDir) { $candidates += $userPointer; $candidates += Join-Path $CurrentUserInstallDir 'data' }
        if ($CurrentUserDataDir) { $candidates += FullPath $CurrentUserDataDir }
        $sources = @($candidates | Where-Object { $_ -and (HasData $_) } | ForEach-Object { FullPath $_ } | Select-Object -Unique)
        if (-not $primary) {
            if ($sources.Count -gt 1) { throw 'Multiple existing data directories found without a registered primary. Preserve them and resolve the data-dir.txt pointer before upgrading.' }
            $primary = if ($sources.Count) { $sources[0] } else { $targetData }
        }
        $backupBase = FullPath $BackupRoot
        foreach ($source in @($sources) + @($install, $RegisteredInstallDir, $CurrentUserInstallDir)) {
            if ($source -and ((Inside $backupBase (FullPath $source)) -or $backupBase -eq (FullPath $source))) { throw 'Upgrade backups must be outside every installation and data directory.' }
        }
        $backup = Join-Path $backupBase ([Guid]::NewGuid().ToString())
        New-Item -ItemType Directory -Path $backup -Force | Out-Null
        $records = @()
        foreach ($source in $sources) {
            $destination = Join-Path $backup ('data-' + $records.Count)
            $files = @()
            foreach ($file in @(SourceFiles $source)) {
                $relative = $file.FullName.Substring($source.Length).TrimStart('\')
                $target = Join-Path $destination $relative
                if (-not (Inside (FullPath $target) (FullPath $destination))) { throw 'Invalid backup file path.' }
                $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
                CopyVerified $file.FullName $target $hash
                $files += @{ relative = $relative; hash = $hash; bytes = $file.Length }
            }
            # Record empty databases as well; their original source path is retained.
            $records += @{ source = $source; backup = $destination; files = @($files) }
        }
        $sha = [Security.Cryptography.SHA256]::Create()
        try { $installHash = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($install.ToLowerInvariant()))).Replace('-', '').ToLowerInvariant() }
        finally { $sha.Dispose() }
        $guard = Join-Path $backupBase ('pending-' + $installHash + '.json')
        $state = @{ primary = $primary; backup = $backup; records = @($records); preparedAt = [DateTime]::UtcNow.ToString('o'); installDir = $install; guard = $guard; completed = $false }
        $json = $state | ConvertTo-Json -Depth 8
        [IO.File]::WriteAllText((Join-Path $backup 'manifest.json'), $json, $utf8)
        [IO.File]::WriteAllText($StatePath, $json, $utf8)
        [IO.File]::WriteAllText($guard, $json, $utf8)
    } else {
        $state = [IO.File]::ReadAllText($StatePath, $strictUtf8) | ConvertFrom-Json
        if ((FullPath $state.installDir) -ne $install) { throw 'Upgrade recovery belongs to a different installation.' }
        foreach ($record in $state.records) {
            New-Item -ItemType Directory -Path $record.source -Force | Out-Null
            foreach ($file in $record.files) {
                $source = Join-Path $record.backup $file.relative
                $target = Join-Path $record.source $file.relative
                if (-not (Inside (FullPath $target) (FullPath $record.source)) -or -not (Inside (FullPath $source) (FullPath $record.backup))) { throw 'Invalid recovery file path.' }
                if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $file.hash) { throw 'Independent upgrade backup is damaged. Restore was stopped.' }
                if (Test-Path -LiteralPath $target) {
                    if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $file.hash) { throw "Existing data changed during upgrade; both copies preserved: $target" }
                } else { CopyVerified $source $target $file.hash }
            }
        }
        $primary = FullPath $state.primary
        New-Item -ItemType Directory -Path $primary -Force | Out-Null
        [IO.File]::WriteAllText((Join-Path $install 'data-dir.txt'), $primary, $utf8)
        [IO.File]::WriteAllText((Join-Path $install 'data-dir-uninstall.txt'), $primary, [Text.Encoding]::Unicode)
        [IO.File]::WriteAllText($ResolvedPath, $primary, [Text.Encoding]::Unicode)
        $marker = Join-Path $primary '.infinite-canvas-userdata'
        if (-not (Test-Path -LiteralPath $marker)) { [IO.File]::WriteAllText($marker, 'InfiniteCanvas userData', $utf8) }
        $state.completed = $true
        [IO.File]::WriteAllText($state.guard, ($state | ConvertTo-Json -Depth 8), $utf8)
    }
    exit 0
} catch {
    [IO.File]::WriteAllText($StatePath + '.error.txt', $_.Exception.Message, $utf8)
    Write-Error -Message $_.Exception.Message -ErrorAction Continue
    exit 1
}
