param([string]$OllamaBinary = "", [string]$ModelDirectory = "")
$ErrorActionPreference = "Stop"
$projectDirectory = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location -LiteralPath $projectDirectory
if (-not $OllamaBinary) {
    $installedOllama = Get-Command ollama -ErrorAction SilentlyContinue
    if ($installedOllama) { $OllamaBinary = $installedOllama.Source }
    else {
        $portableRuntime = Join-Path $projectDirectory "..\..\work\ollama\runtime\ollama.exe"
        if (Test-Path -LiteralPath $portableRuntime) {
            $OllamaBinary = (Resolve-Path -LiteralPath $portableRuntime).Path
            if (-not $ModelDirectory) {
                $ModelDirectory = [IO.Path]::GetFullPath((Join-Path $projectDirectory "..\..\work\ollama-models"))
            }
        }
    }
}
try { Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 2 | Out-Null }
catch {
    if (-not $OllamaBinary) { throw "Install Ollama from ollama.com, or pass -OllamaBinary with the official portable runtime path." }
    $env:OLLAMA_HOST = "127.0.0.1:11434"
    $env:OLLAMA_IGPU_ENABLE = "1"
    if ($ModelDirectory) { $env:OLLAMA_MODELS = $ModelDirectory }
    Start-Process -FilePath $OllamaBinary -ArgumentList "serve" -WindowStyle Hidden
    $ready = $false
    for ($attempt=0; $attempt -lt 20; $attempt++) {
        Start-Sleep -Milliseconds 500
        try { Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 2 | Out-Null; $ready=$true; break }
        catch { }
    }
    if (-not $ready) { throw "Ollama did not start. Check its server log." }
}
$env:OLLAMA_HOST = "127.0.0.1:11434"
if ($OllamaBinary) { & $OllamaBinary pull qwen3:4b }
& (Join-Path $projectDirectory ".venv\Scripts\python.exe") -m uvicorn fencecoach.api:app --host 127.0.0.1 --port 8000
