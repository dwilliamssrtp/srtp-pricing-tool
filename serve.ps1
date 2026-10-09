# Minimal static file server for local testing.
# ES modules will not load over file://, so the site needs a real HTTP origin.
#   powershell -NoProfile -File serve.ps1          -> http://localhost:8777
param([int]$Port = 8777)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$types = @{
  ".html"="text/html; charset=utf-8"; ".js"="text/javascript; charset=utf-8";
  ".css"="text/css; charset=utf-8";   ".json"="application/json; charset=utf-8";
  ".svg"="image/svg+xml"; ".png"="image/png"; ".ico"="image/x-icon";
  ".sql"="text/plain; charset=utf-8"; ".md"="text/plain; charset=utf-8"
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Output "serving $root on http://localhost:$Port/  (Ctrl+C to stop)"

while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    $rel = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    if ($rel -eq "") { $rel = "index.html" }

    $full = Join-Path $root $rel
    # Keep the server inside its own folder.
    $resolved = [System.IO.Path]::GetFullPath($full)
    if (-not $resolved.StartsWith([System.IO.Path]::GetFullPath($root))) {
      $ctx.Response.StatusCode = 403; $ctx.Response.Close(); continue
    }

    if (Test-Path $resolved -PathType Leaf) {
      $bytes = [System.IO.File]::ReadAllBytes($resolved)
      $ext = [System.IO.Path]::GetExtension($resolved).ToLower()
      $ctx.Response.ContentType = $(if ($types.ContainsKey($ext)) { $types[$ext] } else { "application/octet-stream" })
      $ctx.Response.Headers.Add("Cache-Control", "no-store")
      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
      Write-Output ("200 /{0}" -f $rel)
    } else {
      $ctx.Response.StatusCode = 404
      Write-Output ("404 /{0}" -f $rel)
    }
    $ctx.Response.Close()
  } catch {
    Write-Output ("ERR {0}" -f $_.Exception.Message)
  }
}
