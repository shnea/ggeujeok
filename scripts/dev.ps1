# Usage: ./scripts/dev.ps1 [docker compose arguments]; default: up -d --build --wait.
$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
$BinaryName = if ($env:OS -eq 'Windows_NT') { 'dotenvx.exe' } else { 'dotenvx' }
$Dotenvx = Join-Path $Root ".tools/$BinaryName"
if (-not (Test-Path -LiteralPath $Dotenvx)) {
    $Dotenvx = (Get-Command dotenvx -ErrorAction Stop).Source
}
$ComposeArgs = @($args)
if ($ComposeArgs.Count -eq 0) { $ComposeArgs = @('up', '-d', '--build', '--wait', '--wait-timeout', '300') }
if ($ComposeArgs -contains 'config' -and $ComposeArgs -notcontains '--quiet') {
    throw 'Use config --quiet to avoid printing decrypted secrets.'
}
$Saved = @{}
Push-Location $Root
try {
    $Json = & $Dotenvx get --strict --overload --no-armor --no-native -f .env.dev --format json
    if ($LASTEXITCODE -ne 0) { throw 'Development environment decryption failed.' }
    $Values = ($Json -join "`n") | ConvertFrom-Json
    if ($Values.APP_ENV -ne 'development' -or $Values.COMPOSE_PROJECT_NAME -notmatch '-dev$') {
        throw 'Expected an isolated development environment and a project name ending in -dev.'
    }
    foreach ($Property in $Values.PSObject.Properties) {
        $Saved[$Property.Name] = [Environment]::GetEnvironmentVariable($Property.Name, 'Process')
        [Environment]::SetEnvironmentVariable($Property.Name, [string]$Property.Value, 'Process')
    }
    foreach ($Name in @('IMAGE_TAG', 'COMPOSE_FILE', 'COMPOSE_PATH_SEPARATOR', 'COMPOSE_PROFILES')) {
        if (-not $Saved.ContainsKey($Name)) { $Saved[$Name] = [Environment]::GetEnvironmentVariable($Name, 'Process') }
        [Environment]::SetEnvironmentVariable($Name, $null, 'Process')
    }
    $env:IMAGE_TAG = 'dev'
    & docker compose --env-file .env.example -f compose.yaml -f compose.dev.yaml @ComposeArgs
    if ($LASTEXITCODE -ne 0) { throw "Development Compose failed (exit $LASTEXITCODE)." }
} finally {
    foreach ($Name in $Saved.Keys) { [Environment]::SetEnvironmentVariable($Name, $Saved[$Name], 'Process') }
    Pop-Location
}
