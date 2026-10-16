#requires -Version 7.0
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$extensionRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$projectRoot = (Resolve-Path (Join-Path $extensionRoot '..')).Path
$stageRoot = Join-Path $projectRoot ('.recovery\vsix\' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
$stagingExtension = Join-Path $stageRoot 'extension'
New-Item -ItemType Directory -Path $stagingExtension -Force | Out-Null
foreach ($name in @('package.json','package-lock.json','extension.cjs','README.md','LICENSE','media','schemas','syntaxes','src','scripts','test','test-host','tsconfig.json')) {
    Copy-Item -LiteralPath (Join-Path $extensionRoot $name) -Destination $stagingExtension -Recurse
}
New-Item -ItemType Directory -Path (Join-Path $stagingExtension 'dist') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $extensionRoot 'dist\src') -Destination (Join-Path $stagingExtension 'dist') -Recurse
Copy-Item -LiteralPath (Join-Path $extensionRoot 'dist\runtime') -Destination (Join-Path $stagingExtension 'dist') -Recurse
$dependencyPaths = & npm.cmd ls --prefix $extensionRoot --omit=dev --all --parseable
if ($LASTEXITCODE -ne 0) { throw 'Production dependency inventory failed' }
foreach ($dependency in $dependencyPaths) {
    if ($dependency -eq $extensionRoot) { continue }
    $absolute = [IO.Path]::GetFullPath($dependency)
    $relative = $absolute.Substring($extensionRoot.Length + 1)
    if (-not $relative.StartsWith('node_modules\') -or -not $absolute.StartsWith($extensionRoot + [IO.Path]::DirectorySeparatorChar)) { throw 'Dependency outside extension' }
    $destination = Join-Path $stagingExtension $relative
    if (-not (Test-Path -LiteralPath $destination)) {
        New-Item -ItemType Directory -Path (Split-Path $destination) -Force | Out-Null
        Copy-Item -LiteralPath $absolute -Destination $destination -Recurse
    }
}
$sourceRoot = Join-Path $stagingExtension 'sources'
New-Item -ItemType Directory -Path $sourceRoot -Force | Out-Null
& git -C (Join-Path $projectRoot 'vivliostyle') bundle create (Join-Path $sourceRoot 'vivliostyle.bundle') HEAD
if ($LASTEXITCODE -ne 0) { throw 'Core source bundle failed' }
Copy-Item -LiteralPath (Join-Path $projectRoot 'core-revision.json') -Destination $sourceRoot
# The bundle records committed history. Include the exact build sources as well,
# so a local, uncommitted Core build never ships without corresponding source.
$coreSnapshot = Join-Path $sourceRoot 'core'
New-Item -ItemType Directory -Path $coreSnapshot -Force | Out-Null
foreach ($name in @('src','types','scripts','package.json','package-lock.json','tsconfig.json')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot ('vivliostyle\packages\core\' + $name)) -Destination $coreSnapshot -Recurse
}
$coreMetadata = Get-Content -LiteralPath (Join-Path $sourceRoot 'core-revision.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$coreMetadata | Add-Member -NotePropertyName sourceSnapshot -NotePropertyValue 'core/' -Force
$runtimeStream = [IO.File]::OpenRead((Join-Path $stagingExtension 'dist\runtime\core.js'))
$runtimeHasher = [Security.Cryptography.SHA256]::Create()
try {
    $runtimeHash = ([BitConverter]::ToString($runtimeHasher.ComputeHash($runtimeStream))).Replace('-','').ToLowerInvariant()
} finally {
    $runtimeHasher.Dispose()
    $runtimeStream.Dispose()
}
$coreMetadata | Add-Member -NotePropertyName runtimeSha256 -NotePropertyValue $runtimeHash -Force
$coreMetadata | Add-Member -NotePropertyName workingTreeSnapshot -NotePropertyValue $true -Force
[IO.File]::WriteAllText((Join-Path $sourceRoot 'core-revision.json'),($coreMetadata | ConvertTo-Json),[Text.UTF8Encoding]::new($false))
foreach ($name in @('LICENSE','NOTICE')) { Copy-Item -LiteralPath (Join-Path $projectRoot ('vivliostyle\packages\core\' + $name)) -Destination (Join-Path $sourceRoot ('Core-' + $name)) }
Copy-Item -LiteralPath (Join-Path $projectRoot 'vivliostyle\CHANGES.md') -Destination (Join-Path $sourceRoot 'Core-CHANGES.md')
Copy-Item -LiteralPath (Join-Path $extensionRoot 'SOURCE_CODE.md') -Destination $stagingExtension
Copy-Item -LiteralPath (Join-Path $extensionRoot 'THIRD_PARTY_NOTICES.md') -Destination $stagingExtension
$manifest = Get-Content -LiteralPath (Join-Path $extensionRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$xml = @"
<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011"><Metadata><Identity Language="ja-JP" Id="$($manifest.name)" Version="$($manifest.version)" Publisher="$($manifest.publisher)"/><DisplayName>Ogenkou</DisplayName><Description xml:space="preserve">日本語小説の組版プレビューとPDF出力</Description><Tags>novel,Japanese,preview</Tags><Categories>Other</Categories><GalleryFlags>Public</GalleryFlags><Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="$($manifest.engines.vscode)"/></Properties><License>extension/LICENSE</License></Metadata><Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/><Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/><Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true"/></Assets></PackageManifest>
"@
[IO.File]::WriteAllText((Join-Path $stageRoot 'extension.vsixmanifest'),$xml,[Text.UTF8Encoding]::new($false))
$types = '<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/><Default Extension="vsixmanifest" ContentType="text/xml"/><Default Extension="md" ContentType="text/markdown"/><Default Extension="js" ContentType="application/javascript"/><Default Extension="mjs" ContentType="application/javascript"/><Default Extension="cjs" ContentType="application/javascript"/><Default Extension="ts" ContentType="text/plain"/><Default Extension="bundle" ContentType="application/octet-stream"/><Default Extension="png" ContentType="image/png"/><Default Extension="gif" ContentType="image/gif"/></Types>'
[IO.File]::WriteAllText((Join-Path $stageRoot '[Content_Types].xml'),$types,[Text.UTF8Encoding]::new($false))
$artifacts = Join-Path $extensionRoot 'artifacts'
New-Item -ItemType Directory -Path $artifacts -Force | Out-Null
$zip = $stageRoot + '.zip'
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($stageRoot, $zip, [IO.Compression.CompressionLevel]::Optimal, $false)
$output = Join-Path $artifacts ('ogenkou-' + $manifest.version + '.vsix')
Copy-Item -LiteralPath $zip -Destination $output
Get-Item -LiteralPath $output | Select-Object FullName,Length
