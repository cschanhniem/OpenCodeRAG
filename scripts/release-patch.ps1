param(
  [switch]$Dry
)

$dryRun = ($env:DRY_RUN -eq '1') -or $Dry

function Run($cmd) {
  Write-Host "> $cmd"
  if (-not $dryRun) {
    Invoke-Expression $cmd
    if ($LASTEXITCODE -ne 0) { throw "Command failed with exit code $LASTEXITCODE" }
  } else {
    Write-Host '(dry run) skipped'
  }
}

try {
  $prevTag = (git describe --tags --abbrev=0).Trim()
  Write-Host "Previous tag: $prevTag"

  $notes = (git log --oneline "$prevTag..HEAD" 2>$null)
  if (-not $notes) {
    throw "No new commits since $prevTag"
  }

    $date = Get-Date -Format "yyyy-MM-dd"
    $notesFile = [System.IO.Path]::GetTempFileName()
    try {
      $bulleted = ($notes | ForEach-Object { "- $_" }) -join "`n"
      Set-Content -Path $notesFile -Value "$date`n`n$bulleted"

    if (-not $dryRun) {
      Run 'git push origin main'
    } else {
      Write-Host '(dry run) would run: git push origin main'
    }

    if (-not $dryRun) {
      Run 'npm version patch'
    } else {
      Write-Host '(dry run) would run: npm version patch'
    }

    $newTag = (git describe --tags --abbrev=0).Trim()
    Write-Host "New tag: $newTag"

    Run "git push origin $newTag"
    Run "gh release create $newTag --title ""Version $newTag"" --notes-file ""$notesFile"""
  } finally {
    Remove-Item $notesFile -ErrorAction SilentlyContinue
  }
} catch {
  Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
