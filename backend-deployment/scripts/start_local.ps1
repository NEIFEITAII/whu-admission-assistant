$ErrorActionPreference = 'Stop'
$packageRoot = Split-Path -Parent $PSScriptRoot
$workspace = Split-Path -Parent $packageRoot
if (Test-Path (Join-Path $workspace 'miniapp/package.json')) {
    $workspace = Split-Path -Parent $workspace
}
$dbgptRoot = Join-Path $workspace 'DB-GPT'
$runtime = Join-Path $packageRoot '.runtime'
$pgData = Join-Path $runtime 'postgres'
$pgCtl = (Get-Command pg_ctl.exe -ErrorAction Stop).Source

function Import-LocalEnvironment([string]$Path) {
    foreach ($line in [IO.File]::ReadLines($Path)) {
        if ($line -match '^([A-Z_]+)=(.*)$') {
            [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')
        }
    }
}

function Test-LocalPort([int]$Port) {
    $client = [Net.Sockets.TcpClient]::new()
    try {
        $client.Connect('127.0.0.1', $Port)
        return $true
    } catch [Net.Sockets.SocketException] {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Start-LocalServer(
    [string]$Name,
    [string]$Executable,
    [string[]]$ServerArgs,
    [string]$Directory,
    [int]$Port
) {
    if (Test-LocalPort $Port) { return }
    $errorLog = Join-Path $runtime "$Name.err.log"
    $process = Start-Process -FilePath $Executable -ArgumentList $ServerArgs `
        -WorkingDirectory $Directory -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $runtime "$Name.out.log") `
        -RedirectStandardError $errorLog
    $deadline = (Get-Date).AddMinutes(3)
    while ((Get-Date) -lt $deadline) {
        if ($process.HasExited) { throw "$Name 启动失败。日志 $errorLog" }
        if (Test-LocalPort $Port) { return }
        Start-Sleep -Seconds 1
    }
    throw "$Name 启动超时。日志 $errorLog"
}

& $pgCtl status -D $pgData | Out-Null
if ($LASTEXITCODE -ne 0) {
    & $pgCtl start -D $pgData -l (Join-Path $runtime 'postgres.log') -w
    if ($LASTEXITCODE -ne 0) { throw '招生数据库启动失败。' }
}

$env:PYTHONUTF8 = '1'
Import-LocalEnvironment (Join-Path $runtime 'db-mcp.env')
Start-LocalServer -Name 'mcp' -Executable (Join-Path $runtime 'mcp-venv/Scripts/python.exe') `
    -ServerArgs @('mcp/db_mcp_server.py') -Directory $packageRoot -Port 8765

Import-LocalEnvironment (Join-Path $runtime 'qwen.env')
$env:ENCRYPT_KEY = $env:WHU_DBGPT_ENCRYPT_KEY
$graphRoot = Join-Path $workspace 'whu-admissions-graphrag'
$env:WHU_DATA = Join-Path $graphRoot 'data'
$env:WHU_EMBED_MODEL = Join-Path $dbgptRoot 'models/bge-small-zh-v1.5'
$env:WHU_LLM = $env:WHU_QWEN_API_BASE.TrimEnd('/') + '/chat/completions'
$env:WHU_LLM_MODEL = 'qwen3.8-flash-next'
$env:WHU_LLM_VERIFY_SSL = 'false'
$env:WHU_LLM_API_KEY = $env:WHU_QWEN_API_KEY
$env:WHU_HOST = '127.0.0.1'
$env:WHU_GRAPH_RETRIEVE_URL = 'http://127.0.0.1:8090/api/retrieve'
Start-LocalServer -Name 'graphrag' -Executable (Join-Path $dbgptRoot '.venv/Scripts/python.exe') `
    -ServerArgs @('app/app.py') -Directory $graphRoot -Port 8090
if ((Invoke-RestMethod -Uri 'http://127.0.0.1:8090/api/stats' -TimeoutSec 10).chunks -le 0) {
    throw 'GraphRAG 索引尚未建立。'
}
Start-LocalServer -Name 'dbgpt' -Executable (Join-Path $dbgptRoot '.venv/Scripts/dbgpt.exe') `
    -ServerArgs @('start', 'webserver', '--config', 'configs/whu-qwen.toml') -Directory $dbgptRoot -Port 15670

if ((Invoke-RestMethod -Uri 'http://127.0.0.1:15670/api/v1/test' -TimeoutSec 10) -ne 'service status is UP') {
    throw 'DB-GPT 服务状态检查未通过。'
}

$embeddingProbe = @{ model = 'BAAI/bge-small-zh-v1.5'; input = @('readiness') } | ConvertTo-Json -Compress
$embeddingReady = $false
$deadline = (Get-Date).AddMinutes(1)
while (-not $embeddingReady -and (Get-Date) -lt $deadline) {
    try {
        $vectors = Invoke-RestMethod -Uri 'http://127.0.0.1:15670/api/worker/embeddings' `
            -Method Post -ContentType 'application/json' -Body $embeddingProbe -TimeoutSec 5
        $embeddingReady = $vectors[0].Count -gt 0
    } catch {
        Start-Sleep -Seconds 2
    }
}
if (-not $embeddingReady) { throw '政策检索模型尚未就绪。' }

Write-Output '后端地址 http://127.0.0.1:15670'
