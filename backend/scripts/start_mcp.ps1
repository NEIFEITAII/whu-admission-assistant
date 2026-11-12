$root = Split-Path -Parent $PSScriptRoot
if (-not $env:DB_MCP_PG_PASSWORD) {
    Write-Host "请先设置 `$env:DB_MCP_PG_PASSWORD" -ForegroundColor Yellow
    exit 1
}
python "$root\mcp\db_mcp_server.py"
