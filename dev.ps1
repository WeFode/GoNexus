#Requires -Version 5.1
<#
.SYNOPSIS
    configure-center 本地一键启动：基础设施 + 配置中心 + 示例微服务 + 节点探针 + 中台前端。

.DESCRIPTION
    .\dev.ps1                   启动全部组件（默认自动打开浏览器）
    .\dev.ps1 -SkipWeb          不启动中台前端
    .\dev.ps1 -SkipAgent        不启动节点探针
    .\dev.ps1 -SkipInfra        不执行 docker compose（假设 etcd/redis/postgres 已在运行）
    .\dev.ps1 -NoBrowser        启动后不自动打开浏览器
    .\dev.ps1 -Stop             停止本脚本启动的进程
    .\dev.ps1 -Stop -StopInfra  同时停止 etcd/redis/postgres 容器（保留数据卷）
    .\dev.ps1 -Restart          停止本脚本启动的进程后重新编译启动（基础设施保持运行）

    日志: .dev\logs\      编译产物: .dev\bin\

.NOTES
    依赖：Go 1.25+、Node.js/npm、Docker Desktop（etcd/redis/postgres 与探针需要）。
    本地默认 PostgreSQL：compose 的 postgres @ 127.0.0.1:5433，配置中心库 config_center、示例业务库 app_db。
    若改用达梦 DM8：改 configure-server/manifest/config/config.yaml 的 database.default.link，
    并把 manifest/etcd-seed/shared/database.yaml 的 link 换成 dm 连接串（或在中台「公共配置」里改）。
#>
[CmdletBinding()]
param(
    [switch]$Stop,
    [switch]$StopInfra,
    [switch]$Restart,
    [switch]$SkipWeb,
    [switch]$SkipAgent,
    [switch]$SkipInfra,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
}
catch { }

$Root = $PSScriptRoot
$DevDir = Join-Path $Root ".dev"
$BinDir = Join-Path $DevDir "bin"
$LogDir = Join-Path $DevDir "logs"
$StateFile = Join-Path $DevDir "state.json"
$script:Started = @()

function Write-Section([string]$Text) {
    Write-Host ""
    Write-Host "==> $Text" -ForegroundColor Cyan
}

function Write-Ok([string]$Text) {
    Write-Host "    [OK] $Text" -ForegroundColor Green
}

function Write-Warn([string]$Text) {
    Write-Host "    [!!] $Text" -ForegroundColor Yellow
}

function Write-Fail([string]$Text) {
    Write-Host "    [XX] $Text" -ForegroundColor Red
}

function Get-PortOwner([int]$Port) {
    try {
        $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop |
            Select-Object -First 1
        if ($null -ne $conn) { return [int]$conn.OwningProcess }
    }
    catch { }
    return 0
}

function Test-PortOpen([int]$Port, [string]$TargetHost = "127.0.0.1") {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $ar = $client.BeginConnect($TargetHost, $Port, $null, $null)
        if (-not $ar.AsyncWaitHandle.WaitOne(500)) { return $false }
        $client.EndConnect($ar)
        return $true
    }
    catch { return $false }
    finally { $client.Close() }
}

function Test-Http200([string]$Url) {
    try {
        $req = [System.Net.HttpWebRequest]::Create($Url)
        $req.Method = "GET"
        $req.Proxy = $null
        $req.Timeout = 2500
        $req.ReadWriteTimeout = 2500
        $resp = $req.GetResponse()
        $code = [int]$resp.StatusCode
        $resp.Close()
        return ($code -eq 200)
    }
    catch { return $false }
}

function Wait-Ready([string]$Name, [scriptblock]$Probe, [int]$TimeoutSec, $Process = $null) {
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if ($null -ne $Process -and $Process.HasExited) { return $false }
        if (& $Probe) { return $true }
        Start-Sleep -Milliseconds 800
    }
    return $false
}

function Save-State {
    if (-not (Test-Path $DevDir)) { New-Item -ItemType Directory -Force -Path $DevDir | Out-Null }
    $payload = [pscustomobject]@{
        startedAt = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
        processes = @($script:Started)
    }
    $payload | ConvertTo-Json -Depth 6 | Set-Content -Path $StateFile -Encoding UTF8
}

function Get-Tail([string]$Path, [int]$Lines = 25) {
    if (Test-Path $Path) {
        return (Get-Content -Path $Path -Tail $Lines -ErrorAction SilentlyContinue | Out-String).Trim()
    }
    return ""
}

function Show-Failure([string]$Name) {
    $entry = $script:Started | Where-Object { $_.name -eq $Name } | Select-Object -First 1
    if (-not $entry) { return }
    Write-Fail "$Name 未能就绪，最近日志："
    $tailOut = Get-Tail $entry.outLog 20
    $tailErr = Get-Tail $entry.errLog 20
    if ($tailOut) { Write-Host $tailOut -ForegroundColor DarkGray }
    if ($tailErr) { Write-Host $tailErr -ForegroundColor DarkGray }
    Write-Host "    完整日志: $($entry.outLog)  $($entry.errLog)" -ForegroundColor DarkGray
}

function Stop-Started {
    if (-not (Test-Path $StateFile)) {
        Write-Warn "没有进程记录（$StateFile），无需停止。"
        return
    }
    $state = Get-Content -Raw -Path $StateFile | ConvertFrom-Json
    foreach ($p in @($state.processes)) {
        if ($null -eq $p -or -not $p.pid) { continue }
        $procId = [int]$p.pid
        $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
        if ($proc) {
            $prevEap = $ErrorActionPreference
            $ErrorActionPreference = "Continue"
            $killExit = 0
            try {
                # 不依赖 PATH：部分终端的环境变量里没有 System32
                $taskkill = if ($env:SystemRoot) { Join-Path $env:SystemRoot "System32\taskkill.exe" } else { "" }
                if ($taskkill -and (Test-Path $taskkill)) {
                    # 子进程可能已自行退出，taskkill 的报错不应中断后续进程的清理
                    & $taskkill /PID $procId /T /F 2>&1 | Out-Null
                    $killExit = $LASTEXITCODE
                }
                else {
                    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
                }
            }
            finally { $ErrorActionPreference = $prevEap }
            if ($killExit -eq 0) { Write-Ok "已停止 $($p.name) (PID $procId)" }
            else { Write-Warn "$($p.name) (PID $procId) 停止命令返回 $killExit，可能已退出" }
        }
        else {
            Write-Host "    [--] $($p.name) (PID $procId) 已不在运行" -ForegroundColor DarkGray
        }
    }
    Remove-Item -Force $StateFile -ErrorAction SilentlyContinue
}

function Assert-PortFree([string]$Label, [int]$Port) {
    $ownerPid = Get-PortOwner $Port
    if ($ownerPid -gt 0) {
        $proc = Get-Process -Id $ownerPid -ErrorAction SilentlyContinue
        $procName = if ($proc) { $proc.ProcessName } else { "unknown" }
        throw "$Label 端口 $Port 已被 $procName (PID $ownerPid) 占用，请先结束该进程。"
    }
}

function Wait-PortRelease([int]$TimeoutSec = 5) {
    $ports = @(9000, 8000)
    if (-not $SkipWeb) { $ports += 5173 }
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $busy = @($ports | Where-Object { (Get-PortOwner $_) -gt 0 })
        if ($busy.Count -eq 0) { return }
        Start-Sleep -Milliseconds 300
    }
}

function Require-Command([string]$Name, [string]$Hint) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "未找到 $Name。$Hint"
    }
}

function Test-Docker {
    try {
        & docker version --format "{{.Server.Version}}" 2>$null | Out-Null
        return ($LASTEXITCODE -eq 0)
    }
    catch { return $false }
}

function Stop-Infra {
    if (Test-Docker) {
        Write-Section "停止 etcd / redis / postgres 容器"
        Push-Location (Join-Path $Root "configure-server")
        try {
            & docker compose down
            if ($LASTEXITCODE -ne 0) { Write-Warn "docker compose down 返回 $LASTEXITCODE" }
            else { Write-Ok "容器已停止（数据卷保留）" }
        }
        finally { Pop-Location }
    }
    else {
        Write-Warn "Docker 不可用，跳过容器停止。"
    }
}

function Ensure-Config([string]$Module, [string]$Label) {
    $cfgDir = Join-Path $Root (Join-Path $Module "manifest\config")
    $cfg = Join-Path $cfgDir "config.yaml"
    $example = Join-Path $cfgDir "config.example.yaml"
    if (Test-Path $cfg) {
        Write-Ok "$Label 配置: $cfg"
        return
    }
    if (Test-Path $example) {
        Copy-Item $example $cfg
        Write-Warn "$Label 缺少 config.yaml，已从 example 复制，请核对连接串: $cfg"
        return
    }
    throw "$Label 缺少 manifest/config/config.yaml"
}

function Build-Go([string]$Module, [string]$Name) {
    $out = Join-Path $BinDir "$Name.exe"
    $prevFlags = $env:GOFLAGS
    $env:GOFLAGS = "-buildvcs=false"
    Push-Location (Join-Path $Root $Module)
    try {
        Write-Host "    go build $Module ..." -ForegroundColor DarkGray
        & go build -o $out .
        if ($LASTEXITCODE -ne 0) { throw "go build 失败: $Module（输出见上方）" }
    }
    finally {
        Pop-Location
        if ($null -ne $prevFlags) { $env:GOFLAGS = $prevFlags }
        else { Remove-Item Env:GOFLAGS -ErrorAction SilentlyContinue }
    }
    Write-Ok "已编译 $Name.exe"
    return $out
}

function Start-DevProcess([string]$Name, [string]$FilePath, [string]$WorkDir, [string[]]$Arguments = @()) {
    $outLog = Join-Path $LogDir "$Name.out.log"
    $errLog = Join-Path $LogDir "$Name.err.log"
    $params = @{
        FilePath               = $FilePath
        WorkingDirectory       = $WorkDir
        RedirectStandardOutput = $outLog
        RedirectStandardError  = $errLog
        WindowStyle            = "Hidden"
        PassThru               = $true
    }
    if ($Arguments -and $Arguments.Count -gt 0) { $params.ArgumentList = $Arguments }
    $proc = Start-Process @params
    $script:Started += [pscustomobject]@{
        name    = $Name
        pid     = $proc.Id
        workDir = $WorkDir
        outLog  = $outLog
        errLog  = $errLog
    }
    Save-State
    Write-Ok "$Name 已启动 (PID $($proc.Id))"
    return $proc
}

# ---------------------------------------------------------------- 停止模式

if ($Stop -and $Restart) {
    Write-Fail "-Restart 不能与 -Stop 同时使用。"
    exit 1
}

if ($Stop) {
    Write-Section "停止本地开发进程"
    Stop-Started
    if ($StopInfra) { Stop-Infra }
    $leftover = @()
    foreach ($item in @(
            [pscustomobject]@{ Name = "configure-server"; Port = 9000 },
            [pscustomobject]@{ Name = "shop-server"; Port = 8000 },
            [pscustomobject]@{ Name = "web"; Port = 5173 }
        )) {
        $ownerPid = Get-PortOwner $item.Port
        if ($ownerPid -gt 0) {
            $proc = Get-Process -Id $ownerPid -ErrorAction SilentlyContinue
            $procName = if ($proc) { $proc.ProcessName } else { "unknown" }
            $leftover += "$($item.Name):$($item.Port) -> $procName (PID $ownerPid)"
        }
    }
    if ($leftover.Count -gt 0) {
        Write-Warn "以下端口仍被占用（不是本脚本启动的进程）：$($leftover -join '; ')"
    }
    exit 0
}

# ---------------------------------------------------------------- 重启模式

if ($Restart) {
    Write-Section "重启本地开发进程"
    Stop-Started
    if ($StopInfra) { Stop-Infra }
    Wait-PortRelease
}

# ---------------------------------------------------------------- 启动前检查

Write-Host ""
Write-Host "configure-center 本地一键启动" -ForegroundColor White
Write-Host "仓库: $Root" -ForegroundColor DarkGray

if (Test-Path $StateFile) {
    $oldState = Get-Content -Raw -Path $StateFile | ConvertFrom-Json
    $alive = @()
    foreach ($p in @($oldState.processes)) {
        if ($null -eq $p -or -not $p.pid) { continue }
        $proc = Get-Process -Id ([int]$p.pid) -ErrorAction SilentlyContinue
        if ($proc) { $alive += "$($p.name)(PID $($p.pid))" }
    }
    if ($alive.Count -gt 0) {
        Write-Warn "上次启动的进程仍在运行: $($alive -join ', ')"
        Write-Warn "请先执行 .\dev.ps1 -Stop 停止后再启动。"
        exit 1
    }
    Remove-Item -Force $StateFile -ErrorAction SilentlyContinue
}

Write-Section "环境检查"
Require-Command go "请安装 Go 1.25+（https://go.dev/dl/）"
$goVersion = (& go version) -replace "^go version ", ""
Write-Ok "Go $goVersion"
if (-not $SkipWeb) {
    Require-Command node "请安装 Node.js 18+（Vite 7 需要较新的 LTS）。"
    Require-Command npm "npm 应随 Node.js 一起安装。"
    Write-Ok "Node $(node --version) / npm $(npm --version)"
}
$dockerOk = Test-Docker
if ($dockerOk) { Write-Ok "Docker 可用" }
else { Write-Warn "Docker 不可用：将跳过依赖容器与节点探针，假设 etcd/redis 已在运行。" }

Assert-PortFree "configure-server" 9000
Assert-PortFree "shop-server" 8000
if (-not $SkipWeb) { Assert-PortFree "中台前端" 5173 }
Write-Ok "端口 9000 / 8000$(if (-not $SkipWeb) { ' / 5173' }) 空闲"

Ensure-Config "configure-server" "配置中心"
Ensure-Config "shop-server" "示例微服务"
if (-not $SkipAgent -and $dockerOk) { Ensure-Config "deploy-agent" "节点探针" }

# ---------------------------------------------------------------- 基础设施

if (-not $SkipInfra) {
    Write-Section "基础设施 (etcd / redis / postgres)"
    if ($dockerOk) {
        Push-Location (Join-Path $Root "configure-server")
        try {
            Write-Host "    docker compose up -d --wait ..." -ForegroundColor DarkGray
            & docker compose up -d --wait --wait-timeout 90
            if ($LASTEXITCODE -ne 0) {
                Write-Warn "docker compose up 返回 $LASTEXITCODE，继续检查本地端口。"
            }
        }
        finally { Pop-Location }
    }
    else {
        Write-Warn "Docker 不可用，跳过 docker compose。"
    }
}

if (Test-PortOpen 2379) { Write-Ok "etcd 已监听 127.0.0.1:2379" }
else { throw "etcd 未在 2379 监听。请启动 Docker Desktop 后重试，或手动启动 etcd。" }
if (Test-PortOpen 6380) { Write-Ok "redis 已监听 127.0.0.1:6380" }
else { Write-Warn "redis 未在 6380 监听：shop-server 的缓存相关接口可能报错。" }
if (Test-PortOpen 5433) { Write-Ok "PostgreSQL 已监听 127.0.0.1:5433" }
else { Write-Warn "PostgreSQL 未在 5433 监听：配置中心审计/登录与 shop-server 业务库会报错。先执行 docker compose up -d postgres。" }

# ---------------------------------------------------------------- 编译

Write-Section "编译 Go 服务"
if (-not (Test-Path $BinDir)) { New-Item -ItemType Directory -Force -Path $BinDir | Out-Null }
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Force -Path $LogDir | Out-Null }
Get-ChildItem $LogDir -File -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue

$configureExe = Build-Go "configure-server" "configure-server"
$shopExe = Build-Go "shop-server" "shop-server"
$agentExe = $null
if (-not $SkipAgent) {
    if ($dockerOk) { $agentExe = Build-Go "deploy-agent" "deploy-agent" }
    else { Write-Warn "Docker 不可用，跳过节点探针。" }
}

# ---------------------------------------------------------------- 启动与就绪检查

try {
    Write-Section "启动配置中心 (:9000)"
    $configureProc = Start-DevProcess "configure-server" $configureExe (Join-Path $Root "configure-server")
    if (-not (Wait-Ready "configure-server" { Test-Http200 "http://127.0.0.1:9000/api/v1/health" } 90 $configureProc)) {
        Show-Failure "configure-server"
        throw "配置中心未就绪（http://127.0.0.1:9000/api/v1/health）。"
    }
    Write-Ok "http://127.0.0.1:9000 已就绪"

    Write-Section "启动示例微服务 (:8000)"
    # shop-server 通过 pkg/obslog 把日志推送到配置中心；令牌使用独立的 auth.observabilityToken。
    $prevObsEndpoint = $env:OBS_ENDPOINT
    $prevObsToken = $env:OBS_TOKEN
    if (-not $env:OBS_ENDPOINT) { $env:OBS_ENDPOINT = "http://127.0.0.1:9000" }
    if (-not $env:OBS_TOKEN) { $env:OBS_TOKEN = "dev-observability-token" }
    $shopProc = Start-DevProcess "shop-server" $shopExe (Join-Path $Root "shop-server")
    $env:OBS_ENDPOINT = $prevObsEndpoint
    $env:OBS_TOKEN = $prevObsToken
    if (-not (Wait-Ready "shop-server" { Test-Http200 "http://127.0.0.1:8000/api/v1/health" } 60 $shopProc)) {
        Show-Failure "shop-server"
        throw "示例微服务未就绪（http://127.0.0.1:8000/api/v1/health）。"
    }
    Write-Ok "http://127.0.0.1:8000 已就绪"

    if ($agentExe) {
        Write-Section "启动节点探针 (deploy-agent)"
        $agentProc = Start-DevProcess "deploy-agent" $agentExe (Join-Path $Root "deploy-agent")
        Start-Sleep -Seconds 2
        if ($agentProc.HasExited) {
            Show-Failure "deploy-agent"
            Write-Warn "探针已退出，节点将不会出现在中台「节点」页。"
        }
        else {
            Write-Ok "探针已启动，nodeId=win-local，每 10s 心跳一次"
        }
    }

    if (-not $SkipWeb) {
        Write-Section "启动中台前端 (:5173)"
        $webDir = Join-Path $Root "web"
        $viteEntry = Join-Path $webDir "node_modules\vite\bin\vite.js"
        if (-not (Test-Path $viteEntry)) {
            Write-Warn "未安装前端依赖，执行 npm install ..."
            Push-Location $webDir
            try {
                & npm install --no-audit --no-fund
                if ($LASTEXITCODE -ne 0) { throw "npm install 失败" }
            }
            finally { Pop-Location }
            Write-Ok "前端依赖安装完成"
        }
        $shell = if ($env:ComSpec) { $env:ComSpec } else { "cmd.exe" }
        $webProc = Start-DevProcess "web" $shell $webDir @("/c", "npm run dev")
        # Vite 默认绑定 localhost，Windows 下通常只有 IPv6 回环 ::1
        if (-not (Wait-Ready "web" { Test-Http200 "http://localhost:5173/" } 90 $webProc)) {
            Show-Failure "web"
            throw "中台前端未就绪（http://localhost:5173）。"
        }
        Write-Ok "http://localhost:5173 已就绪"
    }
}
catch {
    Write-Host ""
    Write-Fail $_.Exception.Message
    Write-Warn "清理本次启动的进程 ..."
    Stop-Started
    exit 1
}

# ---------------------------------------------------------------- 完成

Write-Section "启动完成"
$rows = @(
    [pscustomobject]@{ 服务 = "中台前端"; 地址 = "http://localhost:5173"; 说明 = "登录 admin / admin123" },
    [pscustomobject]@{ 服务 = "配置中心"; 地址 = "http://127.0.0.1:9000"; 说明 = "Swagger: /swagger/" },
    [pscustomobject]@{ 服务 = "示例微服务"; 地址 = "http://127.0.0.1:8000"; 说明 = "健康: /api/v1/health" },
    [pscustomobject]@{ 服务 = "节点探针"; 地址 = "-"; 说明 = "nodeId=win-local" }
)
$rows | Format-Table -AutoSize

Write-Host "日志目录: $LogDir"
Write-Host "重启全部: .\dev.ps1 -Restart" -ForegroundColor Yellow
Write-Host "停止全部: .\dev.ps1 -Stop" -ForegroundColor Yellow
Write-Host "提示: 本机 shop-server 占用 8000；若向本机发布镜像，请改用其他宿主机端口。" -ForegroundColor DarkGray
Write-Host "提示: 本地默认 PostgreSQL(:5433)。若 etcd 是旧数据卷，公共配置里的 database 可能仍是达梦连接串，请在概览页点一次「强制覆盖」写入 PG seed。" -ForegroundColor DarkGray

if (-not $SkipWeb -and -not $NoBrowser) {
    Start-Process "http://localhost:5173"
}
