param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRoot
)

$ErrorActionPreference = 'Stop'

# The launcher passes a quoted Windows path. A project directory ending in a
# backslash can escape the closing quote during Windows command-line parsing,
# leaving a literal quote in this parameter. Strip surrounding quotes before
# calling GetFullPath so paths containing spaces work reliably.
$ProjectRoot = $ProjectRoot.Trim().Trim([char]'"')
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    throw 'Project root was empty. Extract this utility into the Attendly project root and run it there.'
}
try {
    $ProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot)
}
catch {
    throw "Invalid project-root path received: [$ProjectRoot]. $($_.Exception.Message)"
}

if (-not (Test-Path -LiteralPath $ProjectRoot -PathType Container)) {
    throw "Project folder not found: $ProjectRoot"
}

$permanentLaunchers = @('APPLY_UPDATE.bat', 'MIGRATE_DATABASE.bat', 'DEPLOY.bat')
$folders = @(
    'docs\project',
    'docs\getting-started',
    'docs\releases',
    'docs\test-reports',
    'docs\security',
    'docs\operations',
    'docs\maintenance',
    '_archive\legacy-launchers',
    '_archive\maintenance-tools'
)
foreach ($folder in $folders) {
    $path = Join-Path $ProjectRoot $folder
    New-Item -ItemType Directory -Path $path -Force | Out-Null
}

function Get-SafeDestination {
    param([string]$Directory, [string]$FileName)
    $candidate = Join-Path $Directory $FileName
    if (-not (Test-Path -LiteralPath $candidate)) { return $candidate }
    $base = [System.IO.Path]::GetFileNameWithoutExtension($FileName)
    $ext = [System.IO.Path]::GetExtension($FileName)
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $candidate = Join-Path $Directory ("{0}-{1}{2}" -f $base, $stamp, $ext)
    $counter = 1
    while (Test-Path -LiteralPath $candidate) {
        $candidate = Join-Path $Directory ("{0}-{1}-{2}{3}" -f $base, $stamp, $counter, $ext)
        $counter++
    }
    return $candidate
}

function Move-RootFile {
    param([System.IO.FileInfo]$File, [string]$RelativeFolder)
    $destinationFolder = Join-Path $ProjectRoot $RelativeFolder
    New-Item -ItemType Directory -Path $destinationFolder -Force | Out-Null
    $destination = Get-SafeDestination -Directory $destinationFolder -FileName $File.Name
    Move-Item -LiteralPath $File.FullName -Destination $destination
    Write-Host ("  Moved: {0} -> {1}" -f $File.Name, $RelativeFolder) -ForegroundColor DarkGray
}

Write-Host "Organizing Attendly project folder..." -ForegroundColor Cyan
Write-Host "Project root: $ProjectRoot"

$rootFiles = @(Get-ChildItem -LiteralPath $ProjectRoot -File -Force)
$movedDocs = 0
$movedUtilities = 0

foreach ($file in $rootFiles) {
    $name = $file.Name
    $ext = $file.Extension.ToLowerInvariant()
    $target = $null

    if ($ext -eq '.bat') {
        if ($permanentLaunchers -contains $name.ToUpperInvariant()) {
            continue
        }
        if ($name -ieq 'ORGANIZE_ATTENDLY_FOLDER_ONCE.bat') {
            continue
        }
        # Preserve old one-time and version-specific launchers, but keep them out of the root.
        $target = '_archive\legacy-launchers'
        Move-RootFile -File $file -RelativeFolder $target
        $movedUtilities++
        continue
    }

    if ($ext -eq '.md') {
        # Keep the main project README at the root.
        if ($name -ieq 'README.md') { continue }

        if ($name -match '^(TEST_REPORT|TEST-REPORT).*\.md$') {
            $target = 'docs\test-reports'
        }
        elseif ($name -match '^(SECURITY_REVIEW|SECURITY-REVIEW|BOOTSTRAP_SUPER_ADMIN).*\.md$') {
            $target = 'docs\security'
        }
        elseif ($name -match '^(README_V|UPDATE_NOTES_|UPDATE_STATUS_|CHANGELOG).*\.md$') {
            $target = 'docs\releases'
        }
        elseif ($name -match '^(START_HERE|GETTING_STARTED).*\.md$') {
            $target = 'docs\getting-started'
        }
        elseif ($name -match '^(ATTENDLY_SAAS_ARCHITECTURE_AUDIT|README_SAAS|SOURCES).*\.md$') {
            $target = 'docs\project'
        }
        elseif ($name -match '^(README_V0|README_SAAS_BILLING|README_SAAS_FOUNDATION).*\.md$') {
            $target = 'docs\releases'
        }
        else {
            $target = 'docs\operations'
        }
    }
    elseif ($ext -eq '.txt') {
        if ($name -match '^START_HERE') { $target = 'docs\getting-started' }
        else { $target = 'docs\releases' }
    }

    if ($target) {
        Move-RootFile -File $file -RelativeFolder $target
        $movedDocs++
    }
}

# Create a concise root README if there isn't one already. Existing README is never overwritten.
$rootReadme = Join-Path $ProjectRoot 'README.md'
if (-not (Test-Path -LiteralPath $rootReadme)) {
    @'
# Attendly

## Main project folders

- `attendance-management-v1/` — React frontend and legacy/local backend source.
- `cloudflare/` — Cloudflare Worker, D1 migrations and deployment configuration.
- `tools/` — project utilities and maintenance scripts.
- `docs/` — architecture, setup guides, release notes, test reports and policies.
- `_archive/` — old one-time and version-specific launchers, preserved for reference.

## Permanent commands

Use only these three launchers for normal updates:

1. `APPLY_UPDATE.bat` — install/check dependencies and build the application.
2. `MIGRATE_DATABASE.bat` — apply pending remote D1 migrations when a release requires them.
3. `DEPLOY.bat` — publish the application to Cloudflare.

Always read the latest release note in `docs/releases/` before updating. Never replace `cloudflare/wrangler.toml`, delete `node_modules`, or delete database/backup files unless a release instruction explicitly requires it.
'@ | Set-Content -LiteralPath $rootReadme -Encoding UTF8
    Write-Host '  Created: README.md' -ForegroundColor DarkGray
}

Write-Host ''
Write-Host ("Moved documentation files: {0}" -f $movedDocs) -ForegroundColor Green
Write-Host ("Archived old launcher files: {0}" -f $movedUtilities) -ForegroundColor Green
Write-Host 'No project source code, database, Cloudflare configuration, node_modules or secrets were modified.' -ForegroundColor Green
Write-Host 'Folder organization complete.' -ForegroundColor Cyan
