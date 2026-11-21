param([string]$CorpusDir)

$ErrorActionPreference = 'Stop'
$deployment = Split-Path -Parent $PSScriptRoot
$project = Split-Path -Parent $deployment
$dbgpt = Join-Path $project 'vendor/DB-GPT'
$graph = Join-Path $project 'graphrag'
$runtime = Join-Path $deployment '.runtime'
$python = Join-Path $dbgpt '.venv/Scripts/python.exe'

if ($CorpusDir) { $CorpusDir = (Resolve-Path -LiteralPath $CorpusDir).Path }
New-Item -ItemType Directory -Force $runtime | Out-Null
foreach ($name in 'db-mcp.env', 'qwen.env') {
    $target = Join-Path $runtime $name
    if (-not (Test-Path -LiteralPath $target)) {
        Copy-Item -LiteralPath (Join-Path $deployment "config/$name.example") -Destination $target
    }
}

Push-Location $dbgpt
try {
    uv sync --locked --python 3.11 --all-packages --extra base --extra proxy_openai --extra rag --extra storage_chromadb --extra datasource_postgres --extra dbgpts --extra hf --no-dev
    if ($LASTEXITCODE -ne 0) { throw 'DB-GPT 依赖安装失败。' }
} finally {
    Pop-Location
}

uv pip install --python $python jieba==0.42.1 rank-bm25==0.2.2
if ($LASTEXITCODE -ne 0) { throw 'GraphRAG 依赖安装失败。' }

$env:PYTHONUTF8 = '1'
$env:WHU_EMBED_MODEL = Join-Path $dbgpt 'models/bge-small-zh-v1.5'
if (-not (Test-Path (Join-Path $env:WHU_EMBED_MODEL 'model.safetensors'))) {
    & $python -c 'from huggingface_hub import snapshot_download; import os; snapshot_download("BAAI/bge-small-zh-v1.5", local_dir=os.environ["WHU_EMBED_MODEL"], allow_patterns=["*.json", "model.safetensors", "vocab.txt"])'
    if ($LASTEXITCODE -ne 0) { throw '向量模型下载失败。' }
}

$env:WHU_DATA = Join-Path $graph 'data'
if (-not (Test-Path (Join-Path $env:WHU_DATA 'pages.jsonl'))) {
    if ($CorpusDir) {
        & $python (Join-Path $graph 'app/import_local_docs.py') $CorpusDir
    } else {
        & $python (Join-Path $graph 'app/crawl.py')
    }
    if ($LASTEXITCODE -ne 0) { throw '招生语料准备失败。' }
}

& $python (Join-Path $graph 'app/build_index.py')
if ($LASTEXITCODE -ne 0 -or -not (Test-Path (Join-Path $env:WHU_DATA 'embeddings.npy'))) {
    throw 'GraphRAG 索引构建失败。'
}
