$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$testRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../data/protection-tests'))
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
$helper = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../electron/nsis/canvas-data-upgrade.ps1'))
$utf8 = New-Object Text.UTF8Encoding($false)
$global:canvasTestAppRunning = $false
function Get-Process { param($Name, $ErrorAction) if ($global:canvasTestAppRunning) { [pscustomobject]@{ Id = 123 } } }
function Assert($condition, $label) { if (-not $condition) { throw $label } }
function Fixture([bool]$external = $false, [bool]$newLocation = $false) {
    $root = Join-Path $testRoot ('upgrade-' + [Guid]::NewGuid().ToString())
    $old = Join-Path $root 'old-install'
    $target = if ($newLocation) { Join-Path $root 'new-install' } else { $old }
    $data = if ($external) { Join-Path $root ('custom-' + [char]0x753b + [char]0x5e03) } else { Join-Path $old 'data' }
    New-Item -ItemType Directory -Path (Join-Path $data 'IndexedDB'), (Join-Path $data 'canvas-data'), $old, $target -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $old 'program.txt'), 'old-program', $utf8)
    [IO.File]::WriteAllText((Join-Path $old 'data-dir.txt'), $data, [Text.Encoding]::Default)
    [IO.File]::WriteAllText((Join-Path $data 'IndexedDB/000001.ldb'), 'original-project-data', $utf8)
    [IO.File]::WriteAllBytes((Join-Path $data 'canvas-data/media.bin'), [byte[]](0, 1, 255, 73, 200))
    return @{ root = $root; old = $old; target = $target; data = $data; state = (Join-Path $root 'state.json'); backup = (Join-Path $root 'backups'); profile = (Join-Path $root 'empty-profile') }
}
function Prepare($fixture) {
    & $helper -Mode Prepare -InstallDir $fixture.target -RegisteredInstallDir $fixture.old -RegisteredDataDir $fixture.data -LegacyProfileDir $fixture.profile -StatePath $fixture.state -BackupRoot $fixture.backup *> (Join-Path $fixture.root 'prepare.log')
    return $LASTEXITCODE
}
function Restore($fixture) {
    & $helper -Mode Restore -InstallDir $fixture.target -StatePath $fixture.state -ResolvedPath (Join-Path $fixture.root 'resolved.txt') *> (Join-Path $fixture.root 'restore.log')
    return $LASTEXITCODE
}
function SimulateOldUninstaller($fixture) {
    $resolved = (Resolve-Path -LiteralPath $fixture.old).Path
    if (-not $resolved.StartsWith($testRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or -not $resolved.EndsWith('\old-install')) { throw 'Refused removal outside the isolated fixture.' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
    New-Item -ItemType Directory -Path $fixture.target -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $fixture.target 'program.txt'), 'new-program', $utf8)
}

foreach ($scenario in @(@($false, $false), @($true, $false), @($false, $true))) {
    $fixture = Fixture $scenario[0] $scenario[1]
    Assert ((Prepare $fixture) -eq 0) ('Prepare failed: ' + $fixture.root)
    $state = [IO.File]::ReadAllText($fixture.state) | ConvertFrom-Json
    Assert (-not ([IO.File]::ReadAllText($state.guard) | ConvertFrom-Json).completed) 'Upgrade guard was not set before uninstall'
    SimulateOldUninstaller $fixture
    Assert ((Restore $fixture) -eq 0) ('Restore failed: ' + $fixture.root)
    Assert ([IO.File]::ReadAllText($state.guard) | ConvertFrom-Json).completed 'Completed upgrade still blocked'
    Assert ([IO.File]::ReadAllText((Join-Path $fixture.data 'IndexedDB/000001.ldb')) -eq 'original-project-data') 'Project data lost'
    Assert ([IO.File]::ReadAllBytes((Join-Path $fixture.data 'canvas-data/media.bin')).Length -eq 5) 'Media lost'
    Assert ([IO.File]::ReadAllText((Join-Path $fixture.target 'data-dir.txt'), $utf8) -eq $fixture.data) 'Original data directory changed'
    Assert ([IO.File]::ReadAllText((Join-Path $fixture.target 'program.txt')) -eq 'new-program') 'Old application files were restored'
    Write-Output ('PASS: upgrade round-trip external=' + $scenario[0] + ' changed-install=' + $scenario[1])
}
$fixture = Fixture
$handle = [IO.File]::Open((Join-Path $fixture.data 'IndexedDB/000001.ldb'), [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
try { Assert ((Prepare $fixture) -ne 0) 'Locked database should stop backup' } finally { $handle.Dispose() }
Assert (Test-Path -LiteralPath (Join-Path $fixture.old 'program.txt')) 'Failed backup touched old installation'
Write-Output 'PASS: locked database stops upgrade before uninstall'

$fixture = Fixture
Assert ((Prepare $fixture) -eq 0) 'Prepare failed'
[IO.File]::WriteAllText((Join-Path $fixture.data 'IndexedDB/000001.ldb'), 'newer-user-data', $utf8)
Assert ((Restore $fixture) -ne 0) 'Concurrent changes should stop restore'
Assert ([IO.File]::ReadAllText((Join-Path $fixture.data 'IndexedDB/000001.ldb')) -eq 'newer-user-data') 'Concurrent data overwritten'
Write-Output 'PASS: changed source preserved during restore'

$fixture = Fixture
[IO.File]::WriteAllText((Join-Path $fixture.old 'data-dir.txt'), (Join-Path $fixture.root 'missing-data'), $utf8)
Assert ((Prepare $fixture) -ne 0) 'Missing registered data should stop upgrade'
Assert (-not (Test-Path -LiteralPath (Join-Path $fixture.root 'missing-data'))) 'Missing data replaced with an empty directory'
Write-Output 'PASS: missing data directory does not fall back to empty data'

$fixture = Fixture
$global:canvasTestAppRunning = $true
Assert ((Prepare $fixture) -ne 0) 'Open app should stop backup'
$global:canvasTestAppRunning = $false
Write-Output 'PASS: running app stops upgrade'
Write-Output '7 upgrade data-protection scenarios passed.'
