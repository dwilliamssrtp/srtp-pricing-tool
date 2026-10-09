# Stamp a new build id across the module graph.
#
# GitHub Pages serves everything with Cache-Control: max-age=600, so for ten
# minutes after a deploy a browser can hold a STALE copy of any file - and,
# worse, can end up with a fresh index.html next to a stale app/ui.js. That
# mixture fails in confusing ways.
#
# Giving every import the same ?v= token makes each deploy a distinct set of
# URLs, so the browser either has the whole new build or fetches all of it.
#
#   powershell -NoProfile -File bump.ps1
# Run this before committing whenever any file under app/ changes.

$ErrorActionPreference = "Stop"
$root  = $PSScriptRoot
$build = Get-Date -Format "yyyyMMdd-HHmm"

$targets = @("index.html") + (Get-ChildItem (Join-Path $root "app") -Filter *.js | ForEach-Object { "app/$($_.Name)" })

foreach ($rel in $targets) {
  $path = Join-Path $root $rel
  $text = [System.IO.File]::ReadAllText($path)

  # entry point in index.html, and every relative import inside the modules
  $text = [regex]::Replace($text, '(src="app/[A-Za-z0-9_.-]+\.js)(\?v=[^"]*)?(")',      "`${1}?v=$build`${3}")
  $text = [regex]::Replace($text, '(from\s+"\./[A-Za-z0-9_.-]+\.js)(\?v=[^"]*)?(")',    "`${1}?v=$build`${3}")
  $text = [regex]::Replace($text, '(import\("\./[A-Za-z0-9_.-]+\.js)(\?v=[^"]*)?("\))', "`${1}?v=$build`${3}")
  $text = [regex]::Replace($text, '(const BUILD = ")[^"]*(")',                           "`${1}$build`${2}")

  [System.IO.File]::WriteAllText($path, $text, [System.Text.UTF8Encoding]::new($false))
}

Write-Output "stamped build $build across $($targets.Count) files"
