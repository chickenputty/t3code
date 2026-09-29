#Requires -Version 7.2
<#
.SYNOPSIS
  Carries this fork's patches on top of upstream T3 Code: merges upstream main, builds the
  Windows app, publishes it to the fork's GitHub releases (the installed app updates from there)
  and moves main forward. See fork/README.md.

.EXAMPLE
  pwsh fork/fork.ps1 sync            # what the daily task runs
  pwsh fork/fork.ps1 sync -NoPublish # build an installer from main without publishing it
  pwsh fork/fork.ps1 status
  pwsh fork/fork.ps1 patches
  pwsh fork/fork.ps1 merge           # merge upstream into main by hand when sync hit a conflict
  pwsh fork/fork.ps1 install         # install the newest fork build (waits for T3 Code to quit)
  pwsh fork/fork.ps1 task install    # register the daily sync task
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet('sync', 'status', 'patches', 'merge', 'install', 'task', 'help')]
  [string]$Command = 'help',
  [Parameter(Position = 1)]
  [string]$Action,
  # sync: build even when nothing changed since the last published build.
  [switch]$Force,
  # sync: build the installer but do not push, publish or move main.
  [switch]$NoPublish,
  # sync: override the computed version. install: which fork build to install.
  [string]$Version,
  # Branch that carries the fork (tests point this at a scratch branch).
  [string]$Branch = 'main',
  [string]$UpstreamRef = 'refs/remotes/upstream/main',
  # install: run the installer now (used by the one-shot install task).
  [switch]$Now,
  [switch]$SkipBackup
)

$ErrorActionPreference = 'Stop'

$ReleaseRepo = 'chickenputty/t3code'
$StateDir = Join-Path $env:LOCALAPPDATA 't3code-fork'
$BuildDir = Join-Path $StateDir 'build'
$ReleaseDir = Join-Path $StateDir 'release'
$LogDir = Join-Path $StateDir 'logs'
$BackupDir = Join-Path $StateDir 'backups'
$StatePath = Join-Path $StateDir 'state.json'
$ConfigPath = Join-Path $StateDir 'config.json'
$RustupHome = Join-Path $StateDir 'rustup'
$SyncTaskName = 'T3 Code fork sync'
$InstallTaskName = 'T3 Code fork install'
$KeepReleases = 5
$KeepLocalBuilds = 3
$AppDir = Join-Path $env:LOCALAPPDATA 'Programs\t3code'
$AppExe = Join-Path $AppDir 'T3 Code (Alpha).exe'
$LiveDb = Join-Path $env:USERPROFILE '.t3\userdata\state.sqlite'

# Public T3 Connect settings that official builds bake in (read from the 0.0.42 app bundle on
# 2026-09-29). Without them the fork build loses Connect sign-in, the relay and mobile pairing.
# The official build also carries T3's own relay tracing token; the fork leaves it out on purpose.
$ConnectEnv = [ordered]@{
  T3CODE_CLERK_PUBLISHABLE_KEY     = 'pk_live_Y2xlcmsudDMuY29kZXMk'
  T3CODE_CLERK_JWT_TEMPLATE        = 't3-relay'
  T3CODE_CLERK_CLI_OAUTH_CLIENT_ID = 'hzxSgY2cH10sDU2r'
  T3CODE_RELAY_URL                 = 'https://relay.t3.codes'
}

New-Item -ItemType Directory -Force $StateDir, $LogDir | Out-Null
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$script:RunLog = Join-Path $LogDir "$Command-$Stamp.log"

function Log([string]$Message) {
  $line = "[$(Get-Date -Format 'HH:mm:ss')] $Message"
  Write-Host $line
  Add-Content -Path $script:RunLog -Value $line
}

function Resolve-Repo {
  $parent = Split-Path $PSScriptRoot -Parent
  if ((Test-Path (Join-Path $parent '.git')) -and (Test-Path (Join-Path $parent 'apps\desktop'))) {
    # Running from a checkout. The build worktree is a checkout too; map it back to the main one.
    $common = (& git.exe -C $parent rev-parse --path-format=absolute --git-common-dir).Trim()
    return (Split-Path $common -Parent)
  }
  if (Test-Path $ConfigPath) { return (Get-Content $ConfigPath -Raw | ConvertFrom-Json).repo }
  throw "Cannot find the t3code checkout. Run fork\fork.ps1 task install from it once."
}

function Invoke-Git {
  param([string]$Dir, [Parameter(ValueFromRemainingArguments)][string[]]$GitArgs)
  $out = & git.exe -C $Dir @GitArgs 2>&1
  [pscustomobject]@{ Code = $LASTEXITCODE; Out = (($out | ForEach-Object { "$_" }) -join "`n").Trim() }
}

function GitOut {
  param([string]$Dir, [Parameter(ValueFromRemainingArguments)][string[]]$GitArgs)
  $r = Invoke-Git $Dir @GitArgs
  if ($r.Code -ne 0) { throw "git $($GitArgs -join ' ') failed ($($r.Code)): $($r.Out)" }
  $r.Out
}

function Test-Ancestor([string]$Dir, [string]$Older, [string]$Newer) {
  (Invoke-Git $Dir merge-base --is-ancestor $Older $Newer).Code -eq 0
}

function Short([string]$Sha) { $Sha.Substring(0, 10) }

function Read-State {
  if (Test-Path $StatePath) { return (Get-Content $StatePath -Raw | ConvertFrom-Json -AsHashtable) }
  @{}
}

function Save-State([hashtable]$State) {
  $State | ConvertTo-Json -Depth 6 | Set-Content -Path $StatePath -Encoding UTF8
}

function Show-Toast([string]$Title, [string]$Body) {
  # WinRT toasts need Windows PowerShell; pwsh 7 has no WinRT projection.
  $esc = { param($s) [Security.SecurityElement]::Escape($s) }
  $xml = "<toast><visual><binding template=`"ToastGeneric`"><text>$(& $esc $Title)</text><text>$(& $esc $Body)</text></binding></visual></toast>"
  $ps = @"
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > `$null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > `$null
`$x = New-Object Windows.Data.Xml.Dom.XmlDocument
`$x.LoadXml('$($xml -replace "'", "''")')
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe').Show((New-Object Windows.UI.Notifications.ToastNotification `$x))
"@
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($ps))
  try { & powershell.exe -NoProfile -NonInteractive -EncodedCommand $encoded | Out-Null } catch { }
}

function Get-Pwsh {
  # The Store alias survives pwsh updates; the versioned WindowsApps path does not.
  $alias = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\pwsh.exe'
  if (Test-Path $alias) { return $alias }
  (Get-Command pwsh).Source
}

function Use-BuildTools {
  $vpBin = Join-Path $env:LOCALAPPDATA 'vite-plus\bin'
  if (-not (Test-Path (Join-Path $vpBin 'vp.exe'))) {
    throw "Vite+ is missing. Install it with: irm https://vite.plus/ps1 | iex (then move its PATH entries last, see fork/README.md)"
  }
  $env:Path = "$vpBin;$(Join-Path $env:USERPROFILE '.cargo\bin');$env:Path"
  # The resource monitor follows upstream's latest stable Rust; keep it apart from the system toolchain.
  $env:RUSTUP_HOME = $RustupHome
}

function Invoke-Step([string]$Name, [string]$Dir, [scriptblock]$Block) {
  Log "$Name ..."
  Add-Content -Path $script:RunLog -Value "`n===== $Name ====="
  $sw = [Diagnostics.Stopwatch]::StartNew()
  Push-Location $Dir
  try {
    $global:LASTEXITCODE = 0
    & $Block *>> $script:RunLog
    $code = $LASTEXITCODE
  } finally { Pop-Location }
  if ($code) { throw "$Name failed (exit $code). Log: $script:RunLog" }
  Log "$Name done in $([int]$sw.Elapsed.TotalSeconds)s"
}

function Get-ForkReleases {
  $json = & gh api "repos/$ReleaseRepo/releases?per_page=100"
  if ($LASTEXITCODE) { throw "Listing releases on $ReleaseRepo failed" }
  @($json | ConvertFrom-Json)
}

function Get-NextVersion([string]$Dir, [object[]]$Releases) {
  $pkg = Get-Content (Join-Path $Dir 'apps\desktop\package.json') -Raw | ConvertFrom-Json
  $v = [version]($pkg.version -replace '-.*$', '')
  # Same shape as upstream nightlies (next patch, date, run) so the updater always sees it as newer.
  # "-fork" is not a nightly or preview tag, so the app keeps the stable name, icon and data folders.
  $prefix = "$($v.Major).$($v.Minor).$($v.Build + 1)-fork.$(Get-Date -Format 'yyyyMMdd')."
  $taken = @($Releases | ForEach-Object { $_.tag_name -replace '^v', '' }) +
    @(Get-ChildItem $ReleaseDir -Directory -ErrorAction SilentlyContinue | ForEach-Object Name) |
    Where-Object { $_ -and $_.StartsWith($prefix) } |
    ForEach-Object { [int]$_.Substring($prefix.Length) }
  $n = (@($taken) + 0 | Measure-Object -Maximum).Maximum + 1
  "$prefix$n"
}

function Get-BranchWorktree([string]$Repo, [string]$Name) {
  $path = $null
  foreach ($line in (GitOut $Repo worktree list --porcelain) -split "`n") {
    if ($line -like 'worktree *') { $path = $line.Substring(9) }
    elseif ($line -eq "branch refs/heads/$Name") { return $path }
  }
  $null
}

function Move-LocalBranch([string]$Repo, [string]$Name, [string]$From, [string]$To) {
  if ($From -eq $To) { return "$Name already at $(Short $To)" }
  $wt = Get-BranchWorktree $Repo $Name
  if (-not $wt) {
    GitOut $Repo update-ref "refs/heads/$Name" $To $From | Out-Null
    return "moved $Name to $(Short $To)"
  }
  # Fast-forward the checkout that has the branch out. Git refuses rather than touch local edits.
  $r = Invoke-Git $wt merge --ff-only $To
  if ($r.Code) {
    return "could not fast-forward $Name in $wt ($($r.Out -split "`n" | Select-Object -Last 1)); run 'git merge --ff-only origin/$Name' there"
  }
  "fast-forwarded $Name in $wt to $(Short $To)"
}

function Publish-Release([string]$Ver, [string]$Commit, [string[]]$Files, [string]$Body) {
  # Draft first, so the updater never sees a release whose latest.yml is not uploaded yet.
  $payload = @{
    tag_name         = "v$Ver"
    target_commitish = $Commit
    name             = "T3 Code fork $Ver"
    body             = $Body
    draft            = $true
    prerelease       = $false
  } | ConvertTo-Json
  $rel = $payload | & gh api -X POST "repos/$ReleaseRepo/releases" --input - | ConvertFrom-Json
  if ($LASTEXITCODE -or -not $rel.id) { throw "Creating release v$Ver failed" }
  foreach ($f in $Files) {
    $name = Split-Path $f -Leaf
    & gh api -X POST "https://uploads.github.com/repos/$ReleaseRepo/releases/$($rel.id)/assets?name=$([uri]::EscapeDataString($name))" `
      -H 'Content-Type: application/octet-stream' --input $f | Out-Null
    if ($LASTEXITCODE) { throw "Uploading $name to release v$Ver failed" }
  }
  $done = @{ draft = $false; make_latest = 'true' } | ConvertTo-Json |
    & gh api -X PATCH "repos/$ReleaseRepo/releases/$($rel.id)" --input - | ConvertFrom-Json
  if ($LASTEXITCODE) { throw "Publishing release v$Ver failed" }
  $done.html_url
}

function Remove-OldBuilds {
  $fork = Get-ForkReleases | Where-Object { -not $_.draft -and $_.tag_name -match '^v\d+\.\d+\.\d+-fork\.' } |
    Sort-Object { [datetime]$_.created_at } -Descending
  foreach ($old in ($fork | Select-Object -Skip $KeepReleases)) {
    & gh api -X DELETE "repos/$ReleaseRepo/releases/$($old.id)" | Out-Null
    & gh api -X DELETE "repos/$ReleaseRepo/git/refs/tags/$($old.tag_name)" | Out-Null
    Log "removed old release $($old.tag_name)"
  }
  Get-ChildItem $ReleaseDir -Directory -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending |
    Select-Object -Skip $KeepLocalBuilds | ForEach-Object { Remove-Item $_.FullName -Recurse -Force }
}

function Invoke-Sync {
  $repo = Resolve-Repo
  $lock = $null
  try { $lock = [IO.File]::Open((Join-Path $StateDir 'sync.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
  catch { Log 'Another sync is running.'; return }

  $state = Read-State
  try {
    Log "fetching upstream and origin ($repo)"
    GitOut $repo fetch --quiet upstream '+refs/heads/main:refs/remotes/upstream/main' | Out-Null
    GitOut $repo fetch --quiet origin | Out-Null

    $local = GitOut $repo rev-parse "refs/heads/$Branch"
    $remote = (Invoke-Git $repo rev-parse --verify --quiet "refs/remotes/origin/$Branch").Out
    $base = $local
    if ($remote -and $remote -ne $local) {
      if (Test-Ancestor $repo $local $remote) { $base = $remote }
      elseif (-not (Test-Ancestor $repo $remote $local)) {
        throw "$Branch and origin/$Branch have diverged. Merge origin/$Branch into $Branch by hand, then sync again."
      }
    }
    $up = GitOut $repo rev-parse $UpstreamRef
    $needMerge = -not (Test-Ancestor $repo $up $base)
    $published = $state.published
    if (-not $needMerge -and -not $Force -and -not $NoPublish -and $published -and $published.commit -eq $base) {
      Log "Up to date: $($published.version) is $Branch at $(Short $base), upstream $(Short $up) already merged."
      $state.lastRun = @{ at = (Get-Date).ToString('o'); result = 'up-to-date'; message = $published.version }
      return
    }

    # Build in a worktree of its own so the build never sees half-made edits in the checkout.
    if (-not (Test-Path (Join-Path $BuildDir '.git'))) {
      Log "creating build worktree $BuildDir"
      GitOut $repo worktree add --detach $BuildDir $base | Out-Null
    } else {
      Invoke-Git $BuildDir merge --abort | Out-Null
      GitOut $BuildDir checkout --quiet --detach --force $base | Out-Null
      GitOut $BuildDir clean -fdq | Out-Null
    }
    if ($needMerge) {
      Log "merging upstream $(Short $up) into $Branch $(Short $base)"
      $r = Invoke-Git $BuildDir merge --no-edit -m "Merge upstream main $(Short $up) into fork" $up
      if ($r.Code) {
        $conflicts = (Invoke-Git $BuildDir diff --name-only --diff-filter=U).Out -split "`n" | Where-Object { $_ }
        Invoke-Git $BuildDir merge --abort | Out-Null
        $list = ($conflicts | Select-Object -First 8) -join ', '
        throw "Upstream $(Short $up) conflicts with the fork patches in: $list. Run 'fork.ps1 merge' in the checkout, resolve, commit, then sync."
      }
    }
    $candidate = GitOut $BuildDir rev-parse HEAD
    $releases = if ($NoPublish) { @() } else { Get-ForkReleases }
    $ver = if ($Version) { $Version } else { Get-NextVersion $BuildDir $releases }
    Log "building $ver from $(Short $candidate)"

    Use-BuildTools
    $out = Join-Path $ReleaseDir $ver
    Invoke-Step 'vp install' $BuildDir { vp i }
    # Upstream CI already typechecks upstream main; this gate is for fork patches to the app itself.
    $patched = (Invoke-Git $BuildDir diff --name-only $up $candidate).Out -split "`n" |
      Where-Object { $_ -and -not $_.StartsWith('fork/') }
    if ($patched) { Invoke-Step 'typecheck' $BuildDir { vp run typecheck } }
    Invoke-Step 'rust toolchain' $BuildDir { rustup toolchain install stable --profile minimal --no-self-update }
    Invoke-Step 'resource monitor' $BuildDir {
      cargo build --locked --release --manifest-path native/resource-monitor/Cargo.toml --target x86_64-pc-windows-msvc
    }
    foreach ($k in $ConnectEnv.Keys) { Set-Item "env:$k" $ConnectEnv[$k] }
    $env:T3CODE_DESKTOP_UPDATE_REPOSITORY = $ReleaseRepo
    $env:T3CODE_DESKTOP_REUSE_RESOURCE_MONITOR = '1'
    Invoke-Step 'desktop installer' $BuildDir {
      vp run dist:desktop:artifact --platform win --target nsis --arch x64 --build-version $ver --output-dir $out --verbose
    }
    $exe = Join-Path $out "T3-Code-$ver-x64.exe"
    $files = @($exe, "$exe.blockmap", (Join-Path $out 'latest.yml'))
    foreach ($f in $files) { if (-not (Test-Path $f)) { throw "The build did not produce $f" } }
    # electron-builder prints the publish config it wrote into the app's app-update.yml.
    if (-not (Select-String -Path $script:RunLog -SimpleMatch "`"owner`": `"$($ReleaseRepo.Split('/')[0])`"" -Quiet)) {
      throw "The build log does not show $ReleaseRepo as the app's update feed."
    }

    if ($NoPublish) {
      Log "Built $exe (not published)."
      $state.lastLocalBuild = @{ version = $ver; commit = $candidate; upstream = $up; at = (Get-Date).ToString('o'); installer = $exe }
      $state.lastRun = @{ at = (Get-Date).ToString('o'); result = 'built'; message = $ver }
      return
    }

    if ((GitOut $repo rev-parse "refs/heads/$Branch") -ne $local) {
      throw "$Branch moved during the build; the next sync builds the new commits."
    }
    Log "pushing $(Short $candidate) to origin/$Branch"
    GitOut $repo push --quiet origin "$($candidate):refs/heads/$Branch" | Out-Null

    $patches = (Invoke-Git $repo log --no-merges --format='- %s (%h)' "$up..$candidate").Out
    $body = @(
      "Fork build of ``$(Short $candidate)``: upstream pingdotgg/t3code main at ``$(Short $up)`` plus the fork's patches.",
      '',
      ($patches ? "Fork patches:`n$patches" : 'No fork patches; this is upstream main.'),
      '',
      "Upstream compare: https://github.com/pingdotgg/t3code/compare/$up...$($ReleaseRepo.Replace('/', ':')):$candidate"
    ) -join "`n"
    $url = Publish-Release $ver $candidate $files $body
    Log "published $url"
    Log (Move-LocalBranch $repo $Branch $local $candidate)
    Remove-OldBuilds
    Copy-Item (Join-Path $BuildDir 'fork\fork.ps1') (Join-Path $StateDir 'fork.ps1') -Force

    $state.published = @{ version = $ver; commit = $candidate; upstream = $up; at = (Get-Date).ToString('o'); url = $url; installer = $exe }
    $state.lastRun = @{ at = (Get-Date).ToString('o'); result = 'published'; message = $ver }
    Show-Toast "T3 Code fork $ver is out" 'T3 Code offers it as an update on its next check.'
  } catch {
    $msg = "$_"
    Log "FAILED: $msg"
    $previous = $state.lastRun
    $state.lastRun = @{ at = (Get-Date).ToString('o'); result = 'failed'; message = $msg; log = $script:RunLog }
    if (-not $previous -or $previous.result -ne 'failed' -or $previous.message -ne $msg) {
      Show-Toast 'T3 Code fork sync failed' ($msg.Length -gt 180 ? $msg.Substring(0, 180) + '...' : $msg)
    }
    Save-State $state
    exit 1
  } finally {
    Save-State $state
    if ($lock) { $lock.Dispose() }
  }
}

function Show-Status {
  $repo = Resolve-Repo
  $state = Read-State
  $head = GitOut $repo rev-parse --abbrev-ref HEAD
  $dirty = (GitOut $repo status --porcelain) ? 'uncommitted changes' : 'clean'
  $main = GitOut $repo rev-parse "refs/heads/$Branch"
  $up = GitOut $repo rev-parse $UpstreamRef
  $behind = GitOut $repo rev-list --count "$main..$up"
  $patches = GitOut $repo rev-list --count --no-merges "$up..$main"
  "Checkout    $repo on $head ($dirty)"
  "$Branch        $(Short $main), $patches fork patch commit(s), $behind upstream commit(s) not merged yet (as of the last fetch)"
  if ($state.published) {
    "Published   $($state.published.version) from $(Short $state.published.commit) at $($state.published.at)"
    "            $($state.published.url)"
  } else { 'Published   nothing yet' }
  if ($state.lastRun) {
    "Last sync   $($state.lastRun.result) at $($state.lastRun.at): $($state.lastRun.message)"
    if ($state.lastRun.log) { "            log $($state.lastRun.log)" }
  }
  if (Test-Path $AppExe) {
    $appVer = (Get-Item $AppExe).VersionInfo.ProductVersion
    $feed = Get-Content (Join-Path $AppDir 'resources\app-update.yml') -Raw -ErrorAction SilentlyContinue
    $owner = if ($feed -match 'owner:\s*(\S+)') { $Matches[1] } else { '?' }
    $repoName = if ($feed -match 'repo:\s*(\S+)') { $Matches[1] } else { '?' }
    "Installed   $appVer, updates from $owner/$repoName$(if ($owner -ne $ReleaseRepo.Split('/')[0]) { ' (the official app; run fork.ps1 install to switch)' })"
  }
  $task = Get-ScheduledTask -TaskName $SyncTaskName -ErrorAction SilentlyContinue
  if ($task) {
    $info = $task | Get-ScheduledTaskInfo
    "Daily task  $($task.State), next run $($info.NextRunTime)"
  } else { "Daily task  not registered (fork.ps1 task install)" }
}

function Show-Patches {
  $repo = Resolve-Repo
  $up = GitOut $repo rev-parse $UpstreamRef
  $log = (Invoke-Git $repo log --no-merges --reverse --format='%h %ad %s' --date=short "$up..refs/heads/$Branch").Out
  if (-not $log) { "No fork patches: $Branch is upstream main."; return }
  "Fork patches on $Branch (oldest first):"
  $log
  ''
  (Invoke-Git $repo diff --stat "$up...refs/heads/$Branch").Out
}

function Invoke-ManualMerge {
  $repo = Resolve-Repo
  if ((GitOut $repo rev-parse --abbrev-ref HEAD) -ne $Branch) { throw "Check out $Branch in $repo first." }
  if (GitOut $repo status --porcelain --untracked-files=no) { throw "Commit or put aside the changes in $repo first." }
  GitOut $repo fetch --quiet upstream '+refs/heads/main:refs/remotes/upstream/main' | Out-Null
  $up = GitOut $repo rev-parse $UpstreamRef
  $r = Invoke-Git $repo merge --no-edit -m "Merge upstream main $(Short $up) into fork" $up
  $r.Out
  if ($r.Code) {
    ''
    'Resolve the conflicts above, keeping the fork patch intent on top of the new upstream code, then:'
    '  git add <files>; git commit --no-edit'
    '  vp i; vp run --filter <package> typecheck   (for the packages you touched)'
    '  pwsh fork/fork.ps1 sync'
  } else {
    'Merged cleanly. Run: pwsh fork/fork.ps1 sync'
  }
}

function Backup-LiveDb {
  if ($SkipBackup -or -not (Test-Path $LiveDb)) { return }
  New-Item -ItemType Directory -Force $BackupDir | Out-Null
  $dest = Join-Path $BackupDir "state-$Stamp.sqlite"
  Log "snapshotting $LiveDb to $dest (read-only VACUUM INTO)"
  $js = "const {DatabaseSync}=require('node:sqlite'); new DatabaseSync(process.argv[1],{readOnly:true}).exec(process.argv[2])"
  & node --no-warnings -e $js $LiveDb "VACUUM INTO '$($dest -replace "'", "''")'"
  if ($LASTEXITCODE -or -not (Test-Path $dest)) { throw "Backing up $LiveDb failed; nothing was installed." }
  Get-ChildItem $BackupDir -Filter 'state-*.sqlite' | Sort-Object LastWriteTime -Descending | Select-Object -Skip 1 |
    ForEach-Object { Remove-Item $_.FullName -Force }
}

function Get-Installer([string]$Ver) {
  if (-not $Ver) {
    $state = Read-State
    $Ver = $state.published.version
    if (-not $Ver) { $Ver = (Get-ForkReleases | Where-Object { -not $_.draft -and $_.tag_name -like 'v*-fork.*' } | Select-Object -First 1).tag_name -replace '^v', '' }
    if (-not $Ver) { throw 'No fork build yet. Run fork.ps1 sync first.' }
  }
  $exe = Join-Path $ReleaseDir "$Ver\T3-Code-$Ver-x64.exe"
  if (-not (Test-Path $exe)) {
    New-Item -ItemType Directory -Force (Split-Path $exe) | Out-Null
    Log "downloading v$Ver installer"
    & gh release download "v$Ver" --repo $ReleaseRepo --pattern "T3-Code-$Ver-x64.exe" --dir (Split-Path $exe) --clobber
    if ($LASTEXITCODE -or -not (Test-Path $exe)) { throw "Could not download the v$Ver installer." }
  }
  $exe
}

function Get-AppProcesses {
  Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($AppDir, 'OrdinalIgnoreCase') }
}

function Test-AppRunning { [bool](Get-Process -Name 'T3 Code (Alpha)' -ErrorAction SilentlyContinue) }

function Install-WhenClosed([string]$Exe) {
  Log "waiting for T3 Code to quit before installing $Exe"
  $deadline = (Get-Date).AddHours(24)
  while ((Test-AppRunning) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 5 }
  if (Test-AppRunning) { throw 'T3 Code did not quit within 24 hours; nothing installed.' }
  Start-Sleep -Seconds 3
  # Helpers from the old install (the resource monitor) can outlive the window by a few seconds.
  if (Get-AppProcesses) { Start-Sleep -Seconds 15; Get-AppProcesses | Stop-Process -Force -ErrorAction SilentlyContinue }
  Log "installing $Exe"
  $p = Start-Process -FilePath $Exe -ArgumentList '/S' -PassThru -Wait
  if ($p.ExitCode) { throw "The installer exited with $($p.ExitCode)." }
  $installed = (Get-Item $AppExe).VersionInfo.ProductVersion
  Log "installed $installed; starting T3 Code"
  Start-Process -FilePath $AppExe
  Unregister-ScheduledTask -TaskName $InstallTaskName -Confirm:$false -ErrorAction SilentlyContinue
  Show-Toast 'T3 Code fork installed' "Running $installed. Updates now come from $ReleaseRepo."
}

function Invoke-Install {
  $exe = Get-Installer $Version
  if ($Now) { Install-WhenClosed $exe; return }

  Backup-LiveDb
  if (-not (Test-AppRunning)) { Install-WhenClosed $exe; return }
  # Hand the wait to a scheduled task: a process started from a T3 terminal dies with T3.
  $ver = [IO.Path]::GetFileNameWithoutExtension($exe) -replace '^T3-Code-', '' -replace '-x64$', ''
  Copy-Item $PSCommandPath (Join-Path $StateDir 'fork.ps1') -Force -ErrorAction SilentlyContinue
  $action = New-ScheduledTaskAction -Execute (Get-Pwsh) -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $StateDir 'fork.ps1')`" install -Now -Version $ver"
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddSeconds(10)
  $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 25) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName $InstallTaskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
  Log "Ready: quit T3 Code whenever you like. $ver installs and T3 Code reopens by itself (task '$InstallTaskName', log in $LogDir)."
}

function Invoke-Task {
  switch ($Action) {
    'install' {
      $repo = Resolve-Repo
      @{ repo = $repo } | ConvertTo-Json | Set-Content $ConfigPath -Encoding UTF8
      Copy-Item $PSCommandPath (Join-Path $StateDir 'fork.ps1') -Force
      $pwsh = Get-Pwsh
      # wscript runs the sync without flashing a console window, like the coordinator task.
      $vbs = Join-Path $StateDir 'sync.vbs'
      Set-Content $vbs -Encoding ASCII -Value @(
        'Set sh = CreateObject("WScript.Shell")',
        "sh.Run """"""$pwsh"""" -NoProfile -ExecutionPolicy Bypass -File """"$(Join-Path $StateDir 'fork.ps1')"""" sync"", 0, True"
      )
      $action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$vbs`""
      $trigger = New-ScheduledTaskTrigger -Daily -At '05:17'
      $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
        -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
      Register-ScheduledTask -TaskName $SyncTaskName -Action $action -Trigger $trigger -Settings $settings `
        -Description "Merges upstream T3 Code into $repo, builds the fork app and publishes it to $ReleaseRepo. fork/README.md" -Force | Out-Null
      "Registered '$SyncTaskName' (daily 05:17, catches up after a missed run). Script: $(Join-Path $StateDir 'fork.ps1')"
    }
    'remove' {
      Unregister-ScheduledTask -TaskName $SyncTaskName -Confirm:$false -ErrorAction SilentlyContinue
      "Removed '$SyncTaskName'."
    }
    'run' {
      Start-ScheduledTask -TaskName $SyncTaskName
      "Started '$SyncTaskName'. Follow it with: pwsh fork/fork.ps1 status"
    }
    default { throw 'Usage: fork.ps1 task install|remove|run' }
  }
}

switch ($Command) {
  'sync' { Invoke-Sync }
  'status' { Show-Status }
  'patches' { Show-Patches }
  'merge' { Invoke-ManualMerge }
  'install' { Invoke-Install }
  'task' { Invoke-Task }
  default { Get-Help $PSCommandPath -Examples | Out-String | Write-Host; 'See fork/README.md.' }
}
