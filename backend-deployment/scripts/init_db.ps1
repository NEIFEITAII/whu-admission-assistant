# 初始化 admission_agent 库（需已在 PostgreSQL 中创建空库）
param(
    [string]$DbHost = "127.0.0.1",
    [string]$DbPort = "5432",
    [string]$DbUser = "postgres",
    [string]$DbName = "admission_agent"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

if (-not $env:PGPASSWORD) {
    Write-Host "请先设置 `$env:PGPASSWORD（postgres 用户密码）" -ForegroundColor Yellow
    exit 1
}

Write-Host "导入表结构..." -ForegroundColor Cyan
psql -h $DbHost -p $DbPort -U $DbUser -d $DbName -v ON_ERROR_STOP=1 -f "$root\sql\schema.sql"
if ($LASTEXITCODE -ne 0) { Write-Host "schema.sql 导入失败" -ForegroundColor Red; exit 1 }

Write-Host "导入数据..." -ForegroundColor Cyan
psql -h $DbHost -p $DbPort -U $DbUser -d $DbName -v ON_ERROR_STOP=1 -f "$root\sql\seed.sql"
if ($LASTEXITCODE -ne 0) { Write-Host "seed.sql 导入失败" -ForegroundColor Red; exit 1 }

Write-Host "自检..." -ForegroundColor Cyan
python "$root\verify.py"
