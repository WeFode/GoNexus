# 一键把微服务打成可 docker load 的 tar。
# 使用本机 Go 交叉编译 + scratch 镜像，不拉取 docker.io 基础镜像。
# Windows Docker Desktop 默认 linux/amd64；ARM 机器：-Platform linux/arm64
#
#   .\package.ps1
#   .\package.ps1 -Platform linux/arm64
#   .\package.ps1 -Service shop-server

param(
    [string]$Platform = "linux/amd64",
    [string]$Service = "",
    [string]$OutDir = ""
)

$ErrorActionPreference = "Stop"
$env:DOCKER_BUILDKIT = "1"
$env:GOTOOLCHAIN = "local"
$Root = $PSScriptRoot
if (-not $OutDir) {
    $OutDir = Join-Path $Root "deploy\dist"
}
$CatalogPath = Join-Path $Root "deploy\catalog.json"
$Catalog = Get-Content -Raw -Encoding UTF8 $CatalogPath | ConvertFrom-Json
$RuntimeDocker = Join-Path $Root "deploy\runtime.Dockerfile"

function Convert-PlatformTag([string]$p) {
    return ($p -replace "/", "-")
}

function Get-GoArch([string]$p) {
    switch -Regex ($p) {
        "arm64|aarch64" { return "arm64" }
        default { return "amd64" }
    }
}

docker version | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "未检测到 Docker，请先启动 Docker Desktop"
}
go version | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "未检测到 Go，请先安装 Go 1.25+"
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$tagPlat = Convert-PlatformTag $Platform
$goArch = Get-GoArch $Platform
$targets = @($Catalog.services)
if ($Service) {
    $targets = @($Catalog.services | Where-Object { $_.name -eq $Service })
    if ($targets.Count -eq 0) {
        throw "未知服务: $Service"
    }
}

foreach ($svc in $targets) {
    $name = $svc.name
    $image = "${name}:${tagPlat}"
    $tarName = "${name}-${tagPlat}.tar"
    $tarPath = Join-Path $OutDir $tarName
    $metaPath = Join-Path $OutDir "${name}-${tagPlat}.json"
    $modDir = Join-Path $Root $name
    $work = Join-Path $env:TEMP "cc-pack-$name-$tagPlat"
    if (Test-Path $work) { Remove-Item -Recurse -Force $work }
    New-Item -ItemType Directory -Force -Path $work | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $work "seed") | Out-Null
    Set-Content -Path (Join-Path $work "seed\.keep") -Value ""

    Write-Host "==> go build $name linux/$goArch"
    $env:CGO_ENABLED = "0"
    $env:GOOS = "linux"
    $env:GOARCH = $goArch
    Push-Location $modDir
    try {
        go build -ldflags="-s -w" -o (Join-Path $work "main") .
        if ($LASTEXITCODE -ne 0) { throw "go build 失败: $name" }
    }
    finally {
        Pop-Location
        Remove-Item Env:CGO_ENABLED -ErrorAction SilentlyContinue
        Remove-Item Env:GOOS -ErrorAction SilentlyContinue
        Remove-Item Env:GOARCH -ErrorAction SilentlyContinue
    }

    $example = Join-Path $modDir "manifest\config\config.example.yaml"
    Copy-Item $example (Join-Path $work "config.yaml")
    $seed = Join-Path $modDir "manifest\etcd-seed"
    if (Test-Path $seed) {
        Copy-Item -Path (Join-Path $seed "*") -Destination (Join-Path $work "seed") -Recurse -Force
    }

    Write-Host "==> docker build $image ($Platform)"
    docker build --platform $Platform -t $image -f $RuntimeDocker $work
    if ($LASTEXITCODE -ne 0) { throw "docker build 失败: $name" }

    Write-Host "==> save $tarPath"
    docker save $image -o $tarPath
    if ($LASTEXITCODE -ne 0) { throw "docker save 失败: $name" }

    $meta = [ordered]@{
        service       = $name
        image         = $image
        platform      = $Platform
        containerPort = [int]$svc.containerPort
        tar           = $tarName
        sizeBytes     = (Get-Item $tarPath).Length
        builtAt       = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    }
    $meta | ConvertTo-Json | Set-Content -Encoding UTF8 $metaPath
    Write-Host "    $tarName  $([math]::Round($meta.sizeBytes / 1MB, 1)) MB"
    Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}

Write-Host "完成: $OutDir"
Get-ChildItem $OutDir -File | Format-Table Name, @{N = "MB"; E = { [math]::Round($_.Length / 1MB, 1) } }
