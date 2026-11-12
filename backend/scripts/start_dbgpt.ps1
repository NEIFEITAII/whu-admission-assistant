# 启动 DB-GPT（需先按 README 完成安装，并把 config/dbgpt.toml.example 复制到 DB-GPT/configs/）
param(
    [string]$DbgptRoot = "..\..\DB-GPT",
    [string]$Config = "configs\dbgpt-proxy-deepseek.toml"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

if (-not (Test-Path $DbgptRoot)) {
    Write-Host "未找到 DB-GPT 目录：$DbgptRoot，请用 -DbgptRoot 指定实际路径" -ForegroundColor Yellow
    exit 1
}

Push-Location $DbgptRoot
& "$DbgptRoot\.venv\Scripts\dbgpt.exe" start webserver --config $Config
Pop-Location
