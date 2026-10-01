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
  pwsh fork/fork.ps1 restart         # quit T3 now (after this thread's turn), install, reopen, report
  pwsh fork/fork.ps1 restart -WhenIdle             # the same, once no agent has worked for 10 minutes
  pwsh fork/fork.ps1 restart -WhenIdle -Probe      # what it would do, without doing it
  pwsh fork/fork.ps1 restart -Cancel
  pwsh fork/fork.ps1 task install    # register the daily sync task
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet('sync', 'status', 'patches', 'merge', 'install', 'restart', 'task', 'help')]
  [string]$Command = 'help',
  [Parameter(Position = 1)]
  [string]$Action,
  # sync: build even when nothing changed since the last published build.
  # restart: restart even when T3 already runs the target build.
  [switch]$Force,
  # sync: build the installer but do not push, publish or move main.
  [switch]$NoPublish,
  # sync: override the computed version. install, restart: which fork build to install.
  [string]$Version,
  # Branch that carries the fork (tests point this at a scratch branch).
  [string]$Branch = 'main',
  [string]$UpstreamRef = 'refs/remotes/upstream/main',
  # install, restart: do the waiting in this process (what their one-shot tasks run).
  [switch]$Now,
  [switch]$SkipBackup,
  # No Windows notifications (for runs where someone is watching the console).
  [switch]$Quiet,
  # restart: wait until no agent has worked for 10 minutes instead of restarting right away.
  [switch]$WhenIdle,
  # restart -WhenIdle: regexes for background processes that do not count as agent work
  # (added to config.json "idleIgnore").
  [string[]]$Ignore = @(),
  # restart: stop waiting at this time (default: 30 minutes, or 12 hours with -WhenIdle).
  [Nullable[datetime]]$GiveUpAt,
  # restart: the T3 thread to wait for and report to (default: the thread this runs in, if any).
  [string]$Thread,
  # restart: print what would happen, without arming or quitting anything.
  [switch]$Probe,
  # restart: cancel the armed restart.
  [switch]$Cancel
)

$ErrorActionPreference = 'Stop'

$ReleaseRepo = 'chickenputty/t3code'
# The two overrides let fork/test-restart.ps1 run the install logic against a stand-in app.
$StateDir = $env:T3CODE_FORK_STATE_DIR ?? (Join-Path $env:LOCALAPPDATA 't3code-fork')
$BuildDir = Join-Path $StateDir 'build'
$ReleaseDir = Join-Path $StateDir 'release'
$LogDir = Join-Path $StateDir 'logs'
$BackupDir = Join-Path $StateDir 'backups'
$StatePath = Join-Path $StateDir 'state.json'
$ConfigPath = Join-Path $StateDir 'config.json'
$RustupHome = Join-Path $StateDir 'rustup'
$SyncTaskName = 'T3 Code fork sync'
$InstallTaskName = 'T3 Code fork install'
$RestartTaskName = 'T3 Code fork restart'
$RestartPath = Join-Path $StateDir 'restart.json'
$KeepReleases = 5
$KeepLocalBuilds = 3
$AppDir = $env:T3CODE_FORK_APP_DIR ?? (Join-Path $env:LOCALAPPDATA 'Programs\t3code')
$AppExe = Join-Path $AppDir 'T3 Code (Alpha).exe'
$AppExeName = Split-Path $AppExe -Leaf
$LiveDb = Join-Path $env:USERPROFILE '.t3\userdata\state.sqlite'
# T3's local HTTP API, for "is T3 back" when agent-kit's t3 CLI is not installed.
$ApiPort = 3773
# restart -WhenIdle: minutes with no agent work before T3 restarts, and how often it looks.
$IdlePollSeconds = 30

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
  if ($Quiet) { return }
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
      # An earlier fast-forward may have been refused by local edits; try again.
      if ($local -ne $base) { Log (Move-LocalBranch $repo $Branch $local $base) }
      $state.lastRun = @{ at = (Get-Date).ToString('o'); result = 'up-to-date'; message = $published.version }
      return
    }

    # Build in a worktree of its own so the build never sees half-made edits in the checkout.
    if (-not (Test-Path (Join-Path $BuildDir '.git'))) {
      Log "creating build worktree $BuildDir"
      GitOut $repo worktree prune | Out-Null
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
    Show-Toast "T3 Code fork $ver is out" 'T3 Code offers it as an update within about 4 minutes.'
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
    $build = Get-InstalledBuild
    $feed = Get-Content (Join-Path $AppDir 'resources\app-update.yml') -Raw -ErrorAction SilentlyContinue
    $owner = if ($feed -match 'owner:\s*(\S+)') { $Matches[1] } else { '?' }
    $repoName = if ($feed -match 'repo:\s*(\S+)') { $Matches[1] } else { '?' }
    $main = Get-AppMain | Select-Object -First 1
    $running = $main ? "running since $($main.CreationDate.ToString('yyyy-MM-dd HH:mm'))" : 'not running'
    "Installed   $build ($running), updates from $owner/$repoName$(if ($owner -ne $ReleaseRepo.Split('/')[0]) { ' (the official app; run fork.ps1 install to switch)' })"
    $dl = Get-DownloadedUpdate
    $newest = $state.published ? $state.published.version : $null
    if ($dl -and (Compare-Build $dl $build) -gt 0) { "App update  $dl downloaded; T3 installs it when it quits, then reopens" }
    elseif ($newest -and (Compare-Build $newest $build) -gt 0) { "App update  $newest is out; T3 downloads it at its next check (every 4 minutes), then installs it when it quits" }
    else { 'App update  none; T3 runs the newest fork build' }
  }
  "Armed       $(Get-ArmedSummary)"
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

function Get-ExeVersion([string]$Exe) {
  [IO.Path]::GetFileNameWithoutExtension($Exe) -replace '^T3-Code-', '' -replace '-x64$', ''
}

function Read-Config {
  if (Test-Path $ConfigPath) { return (Get-Content $ConfigPath -Raw | ConvertFrom-Json -AsHashtable) }
  @{}
}

# ---------- The installed app ----------

function Get-InstalledBuild {
  # The build the app runs: the version in its own package.json inside app.asar, read from the
  # archive's header. The exe's ProductVersion drops the fork suffix; FileVersion is the fallback.
  $asar = Join-Path $AppDir 'resources\app.asar'
  if (Test-Path $asar) {
    try {
      $fs = [IO.File]::OpenRead($asar)
      try {
        $r = [IO.BinaryReader]::new($fs)
        [void]$r.ReadUInt32()
        $headerSize = $r.ReadUInt32()
        [void]$r.ReadUInt32()
        $header = [Text.Encoding]::UTF8.GetString($r.ReadBytes($r.ReadInt32())) | ConvertFrom-Json -AsHashtable
        $entry = $header.files['package.json']
        $fs.Position = 8 + $headerSize + [long]$entry.offset
        $pkg = [Text.Encoding]::UTF8.GetString($r.ReadBytes([int]$entry.size)) | ConvertFrom-Json
        if ($pkg.version) { return $pkg.version }
      } finally { $fs.Dispose() }
    } catch { }
  }
  if (Test-Path $AppExe) { return (Get-Item $AppExe).VersionInfo.FileVersion }
  $null
}

function Get-BuildKey([string]$Ver) {
  # Sortable form of 0.0.45-fork.20260930.2; an official 0.0.45 sorts before its fork builds.
  if ($Ver -notmatch '^(\d+)\.(\d+)\.(\d+)(?:-fork\.(\d{8})\.(\d+))?') { return '' }
  '{0:D6}.{1:D6}.{2:D6}.{3}.{4:D6}' -f [int]$Matches[1], [int]$Matches[2], [int]$Matches[3], ($Matches[4] ?? '00000000'), [int]($Matches[5] ?? '0')
}

function Compare-Build([string]$A, [string]$B) { [string]::CompareOrdinal((Get-BuildKey $A), (Get-BuildKey $B)) }

function Get-UpdaterDir {
  if ($env:T3CODE_FORK_UPDATER_DIR) { return $env:T3CODE_FORK_UPDATER_DIR }
  $yml = Get-Content (Join-Path $AppDir 'resources\app-update.yml') -Raw -ErrorAction SilentlyContinue
  Join-Path $env:LOCALAPPDATA ($yml -match 'updaterCacheDirName:\s*(\S+)' ? $Matches[1] : 't3code-updater')
}

function Get-DownloadedUpdate {
  # The build T3 downloaded itself. Fork builds from 0.0.45-fork.20260929.4 on install it when
  # T3 quits (silently, then T3 reopens); older builds wait for the Update button.
  $exe = Get-ChildItem (Join-Path (Get-UpdaterDir) 'pending') -Filter '*.exe' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($exe -and $exe.Name -match '(\d+\.\d+\.\d+-fork\.\d{8}\.\d+)') { return $Matches[1] }
  $null
}

function Get-AppInstallers {
  # Installers T3's own updater started; they run from its cache folder.
  $dir = "$(Get-UpdaterDir)\"
  @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($dir, 'OrdinalIgnoreCase') })
}

function Get-AppProcesses {
  @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith("$AppDir\", 'OrdinalIgnoreCase') })
}

function Get-AppMain {
  # T3's main process: no --type= switch, and not started by another T3 process (its backend is).
  $all = @(Get-CimInstance Win32_Process -Filter "Name='$AppExeName'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith("$AppDir\", 'OrdinalIgnoreCase') })
  $ids = @($all | ForEach-Object ProcessId)
  @($all | Where-Object { $_.CommandLine -notmatch '--type=' -and $_.ParentProcessId -notin $ids })
}

function Test-AppRunning { [bool](Get-AppMain) }

function Wait-AppQuit([datetime]$Until) {
  # Blocks on the handles of T3's main processes as they are now, so a quit followed by a quick
  # reopen still counts as a quit (polling for "no T3 process" misses a reopen 2 seconds later).
  # Returns when they quit, or $null if one still runs at $Until.
  $mains = @(Get-AppMain | ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue } | Where-Object { $_ })
  foreach ($p in $mains) {
    while (-not $p.WaitForExit(1000)) { if ((Get-Date) -gt $Until) { return $null } }
  }
  Get-Date
}

function Request-AppClose([Diagnostics.Process]$P) {
  # What the window's close button does: T3 shuts down cleanly. False while T3 is still starting
  # and has no window yet. (fork/test-restart.ps1 replaces this for its windowless stand-in.)
  if ($P.MainWindowHandle -eq [IntPtr]::Zero) { return $false }
  [void]$P.CloseMainWindow()
  $true
}

function Invoke-Installer([string]$Exe) {
  # NSIS /S: silent, no window. Returns its exit code.
  (Start-Process -FilePath $Exe -ArgumentList '/S' -PassThru -Wait).ExitCode
}

function Close-App([int]$Seconds = 90) {
  # Closes T3 the way its window's close button does, so it shuts down cleanly; ends whatever is
  # left after $Seconds. A T3 that is still starting has no window yet, so keep looking for one.
  $until = (Get-Date).AddSeconds($Seconds)
  $asked = @{}
  while ((Get-Date) -lt $until) {
    $mains = @(Get-AppMain)
    if (-not $mains) { return }
    foreach ($m in $mains) {
      if ($asked["$($m.ProcessId)"]) { continue }
      $p = Get-Process -Id $m.ProcessId -ErrorAction SilentlyContinue
      if ($p -and (Request-AppClose $p)) { $asked["$($m.ProcessId)"] = $true }
    }
    Start-Sleep -Milliseconds 500
  }
  Log "T3 did not close within $Seconds s; ending it"
  Get-AppProcesses | Stop-Process -Force -ErrorAction SilentlyContinue
}

function Clear-ForInstall([datetime]$ClosedAt) {
  # A T3 reopened right after it quit holds the old files and would make the install fail or be
  # skipped: close it again. Then give its helpers (resource monitor, backend) a moment to exit.
  if (Test-AppRunning) {
    Log "T3 was reopened $([int]((Get-Date) - $ClosedAt).TotalSeconds) s after it quit; closing it again so the install runs"
    Close-App 45
  }
  $until = (Get-Date).AddSeconds(15)
  while ((Get-AppProcesses) -and (Get-Date) -lt $until) { Start-Sleep -Milliseconds 500 }
  $left = @(Get-AppProcesses)
  if ($left) {
    Log "ending $(($left | ForEach-Object ProcessName | Sort-Object -Unique) -join ', ') left from the old app"
    $left | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
  }
}

function Start-App { Start-Process -FilePath $AppExe }

function Complete-Install([string]$Exe, [string]$Ver, [datetime]$ClosedAt, [switch]$SkipIfCurrent, [switch]$Rollback) {
  # Runs right after T3 quit. Returns the build installed afterwards, with T3 running on it.
  # A fork build that downloaded an update installs it itself as it quits (and reopens T3). Let
  # that installer finish and install $Ver on top only if it left something older, or if $Ver is
  # an older build asked for on purpose.
  $own = $null
  $until = $ClosedAt.AddSeconds(5)
  while (-not ($own = Get-AppInstallers | Select-Object -First 1) -and (Get-Date) -lt $until) { Start-Sleep -Milliseconds 250 }
  if ($own) {
    Log "T3 is installing the update it downloaded ($(Split-Path $own.ExecutablePath -Leaf)); waiting for it"
    $p = Get-Process -Id $own.ProcessId -ErrorAction SilentlyContinue
    if ($p -and -not $p.WaitForExit(600000)) { throw "T3's own installer was still running after 10 minutes." }
    $got = Get-InstalledBuild
    if (-not $Rollback -and (Compare-Build $got $Ver) -ge 0) {
      Log "T3 installed $got itself"
      # Its installer reopens T3; start it only if that did not happen.
      $back = (Get-Date).AddSeconds(30)
      while (-not (Test-AppRunning) -and (Get-Date) -lt $back) { Start-Sleep -Milliseconds 500 }
      if (-not (Test-AppRunning)) { Log 'starting T3 Code'; Start-App }
      return $got
    }
    Log "T3 installed $got itself; installing $Ver over it$($Rollback ? ' (the older build asked for)' : '')"
    $ClosedAt = Get-Date
    Start-Sleep -Seconds 3
  }

  if ($SkipIfCurrent -and (Get-InstalledBuild) -eq $Ver) {
    Log "T3 already has $Ver; nothing to install"
  } else {
    Clear-ForInstall $ClosedAt
    Log "installing $Exe"
    $code = Invoke-Installer $Exe
    if ($code) { throw "The installer exited with $code." }
    # Opened while the installer ran, T3 may have loaded half-replaced files: restart it.
    if (Test-AppRunning) {
      Log 'T3 was opened during the install; restarting it on the new files'
      Close-App 45
    }
  }
  $got = Get-InstalledBuild
  if (-not (Test-AppRunning)) { Log "installed $got; starting T3 Code"; Start-App }
  $got
}

function Install-WhenClosed([string]$Exe, [string]$Ver) {
  Log "waiting for T3 Code to quit before installing $Exe"
  $rollback = (Compare-Build $Ver (Get-InstalledBuild)) -lt 0
  $closedAt = Wait-AppQuit (Get-Date).AddHours(24)
  if (-not $closedAt) { throw 'T3 Code did not quit within 24 hours; nothing installed.' }
  Log 'T3 Code quit'
  $installed = Complete-Install $Exe $Ver $closedAt -Rollback:$rollback
  Unregister-ScheduledTask -TaskName $InstallTaskName -Confirm:$false -ErrorAction SilentlyContinue
  Show-Toast 'T3 Code fork installed' "Running $installed. Updates now come from $ReleaseRepo."
}

function Get-OneShotScript([string]$Verb) { Join-Path $StateDir "$Verb.vbs" }

function Register-OneShot([string]$Verb, [string]$Name, [string]$Arguments, [timespan]$Limit, [string]$Description) {
  # A one-shot task, so the wait survives T3 closing (a process started from a T3 terminal dies
  # with it). wscript starts pwsh with no window at all; pwsh -WindowStyle Hidden would still
  # flash a console and take the keyboard focus.
  Copy-Item $PSCommandPath (Join-Path $StateDir 'fork.ps1') -Force -ErrorAction SilentlyContinue
  $vbs = Get-OneShotScript $Verb
  Set-Content $vbs -Encoding ASCII -Value @(
    'Set sh = CreateObject("WScript.Shell")',
    "sh.Run """"""$(Get-Pwsh)"""" -NoProfile -ExecutionPolicy Bypass -File """"$(Join-Path $StateDir 'fork.ps1')"""" $Arguments"", 0, True"
  )
  $action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$vbs`""
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddSeconds(5)
  $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit $Limit -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName $Name -Action $action -Trigger $trigger -Settings $settings -Description $Description -Force | Out-Null
}

function Stop-OneShot([string]$Name, [string]$Verb) {
  # Stops and removes a waiting install or restart task. True if there was one.
  $task = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
  if (-not $task) { return $false }
  Stop-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -Filter "Name='pwsh.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match "fork\.ps1`"?\s+$Verb -Now" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Unregister-ScheduledTask -TaskName $Name -Confirm:$false -ErrorAction SilentlyContinue
  $true
}

function Get-ArmedRestart {
  if ((Get-ScheduledTask -TaskName $RestartTaskName -ErrorAction SilentlyContinue) -and (Test-Path $RestartPath)) {
    return (Get-Content $RestartPath -Raw | ConvertFrom-Json -AsHashtable)
  }
  $null
}

function Get-ArmedSummary {
  # The restart or install waiting to run, in one line.
  $parts = @()
  $r = Get-ArmedRestart
  if ($r) {
    $when = $r.whenIdle ? "when no agent has worked for $($r.idleMinutes) minutes" : 'when the requesting turn ends'
    $parts += "restart into $($r.version) $when, until $(([datetime]$r.giveUpAt).ToString('yyyy-MM-dd HH:mm'))$($r.thread ? ", reports to $($r.thread)" : '')"
  }
  if (Get-ScheduledTask -TaskName $InstallTaskName -ErrorAction SilentlyContinue) {
    $how = "$(Get-Content (Get-OneShotScript 'install') -Raw -ErrorAction SilentlyContinue)"
    $parts += $how -match 'install -Now -Version ([^\s"]+)' ? "install of $($Matches[1]) when T3 quits" : 'an install when T3 quits'
  }
  $parts ? ($parts -join '; ') : 'nothing'
}

function Invoke-Install {
  $exe = Get-Installer $Version
  $ver = Get-ExeVersion $exe
  if ($Now) { Install-WhenClosed $exe $ver; return }
  if (Get-ArmedRestart) { throw 'A restart is armed and installs a build itself. Cancel it first: fork.ps1 restart -Cancel' }

  Backup-LiveDb
  if (-not (Test-AppRunning)) { Install-WhenClosed $exe $ver; return }
  Register-OneShot 'install' $InstallTaskName "install -Now -Version $ver" (New-TimeSpan -Hours 25) "Installs T3 Code fork $ver when T3 Code quits. fork/README.md"
  Log "Ready: quit T3 Code whenever you like. $ver installs and T3 Code reopens by itself (task '$InstallTaskName', log in $LogDir)."
}

# ---------- Restart (quit T3, install, reopen, report) ----------

function Get-T3Cli {
  # agent-kit's t3 CLI talks to T3's own HTTP API with a saved token: thread states, send.
  foreach ($p in @($env:T3_CLI, (Read-Config).t3Cli, (Join-Path $env:USERPROFILE 'Workspaces\Centio\agent-kit\bin\t3.mjs'))) {
    if ($p -and (Test-Path $p)) { return $p }
  }
  $null
}

function Invoke-T3([string[]]$T3Args) {
  # The CLI's output, or $null when it is missing or T3 does not answer.
  $cli = Get-T3Cli
  if (-not $cli) { return $null }
  $node = (Get-Command node -ErrorAction SilentlyContinue).Source ?? 'node'
  $out = & $node $cli @T3Args 2>$null
  if ($LASTEXITCODE) { return $null }
  (@($out) | ForEach-Object { "$_" }) -join "`n"
}

function Get-Threads {
  $json = Invoke-T3 @('ls', '--all', '--json')
  if ($null -eq $json) { return $null }
  , @($json | ConvertFrom-Json)
}

function Test-AppApi {
  if (Get-T3Cli) { return $null -ne (Invoke-T3 @('ls', '--json')) }
  $c = [Net.Sockets.TcpClient]::new()
  try { $c.ConnectAsync('127.0.0.1', $ApiPort).Wait(2000) } catch { $false } finally { $c.Dispose() }
}

function Get-AgentWork([string[]]$IgnorePatterns) {
  # Tools running under T3's agent sessions, background jobs of idle threads included. MCP servers,
  # npx launchers, bare shells and git's fsmonitor are not work; neither is anything matching
  # $IgnorePatterns (its children still count).
  $shells = 'bash.exe', 'sh.exe', 'cmd.exe', 'conhost.exe', 'OpenConsole.exe', 'chcp.com'
  $all = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, CommandLine)
  $kids = $all | Group-Object { "$($_.ParentProcessId)" } -AsHashTable
  $appIds = @($all | Where-Object Name -eq $AppExeName | ForEach-Object { "$($_.ProcessId)" })
  $work = [Collections.Generic.List[string]]::new()
  $visit = {
    param($k)
    $ignored = @($IgnorePatterns | Where-Object { $_ -and $k.CommandLine -match $_ })
    if ($k.Name -notin $shells -and $k.CommandLine -notmatch 'fsmonitor--daemon' -and -not $ignored) {
      $line = "$($k.Name) $($k.CommandLine)" -replace '\s+', ' '
      $work.Add($line.Substring(0, [Math]::Min(140, $line.Length)))
    }
    foreach ($c in @($kids["$($k.ProcessId)"])) { if ($c) { & $visit $c } }
  }
  foreach ($s in @($all | Where-Object { $_.Name -in 'claude.exe', 'codex.exe' -and "$($_.ParentProcessId)" -in $appIds })) {
    foreach ($k in @($kids["$($s.ProcessId)"])) {
      if ($k -and $k.CommandLine -notmatch 'mcp|npx') { & $visit $k }
    }
  }
  , $work.ToArray()
}

function Get-BusyReason([string[]]$IgnorePatterns) {
  # '' when no thread is mid-turn and no agent tool runs; otherwise what is busy.
  $threads = Get-Threads
  if ($null -eq $threads) { return 'the T3 API does not answer' }
  $running = @($threads | Where-Object state -eq 'running' | ForEach-Object title)
  $work = Get-AgentWork $IgnorePatterns
  $work = @($work | Select-Object -Unique)
  if (-not ($running.Count + $work.Count)) { return '' }
  (@($running | ForEach-Object { "running: $_" }) + @($work | Select-Object -First 4 | ForEach-Object { "work: $_" })) -join ' | '
}

function Wait-ForTurn([string]$ThreadId, [datetime]$Until) {
  # Lets the thread that asked for the restart finish its turn, so its reply is saved first.
  if (-not $ThreadId) { $q = Wait-AppQuit (Get-Date).AddSeconds(10); return $q ? @{ result = 'quit'; at = $q } : @{ result = 'ready' } }
  while ((Get-Date) -lt $Until) {
    $threads = Get-Threads
    $t = $threads | Where-Object id -eq $ThreadId | Select-Object -First 1
    if ($t -and $t.state -ne 'running') {
      $q = Wait-AppQuit (Get-Date).AddSeconds(10)
      return $q ? @{ result = 'quit'; at = $q } : @{ result = 'ready' }
    }
    $q = Wait-AppQuit (Get-Date).AddSeconds(5)
    if ($q) { return @{ result = 'quit'; at = $q } }
  }
  @{ result = 'gave-up'; reason = 'the thread that asked was still mid-turn' }
}

function Wait-ForIdle([string[]]$IgnorePatterns, [datetime]$Until, [string]$Ver, [int]$Minutes) {
  # Waits for $Minutes with no agent work, warns with a toast, looks once more a minute later.
  # Returns early if T3 quits on its own meanwhile.
  $need = [Math]::Max(1, [int]($Minutes * 60 / $IdlePollSeconds))
  $quiet = 0
  $last = $null
  while ((Get-Date) -lt $Until) {
    $reason = Get-BusyReason $IgnorePatterns
    if ($reason) {
      if ($reason -ne $last) { Log "busy: $reason" }
      $last = $reason
      $quiet = 0
    } else {
      if ($quiet -eq 0) { Log 'quiet; counting' }
      $quiet++
      if ($quiet -ge $need) {
        Show-Toast 'T3 Code restarts in 1 minute' "No agent is working. It installs $Ver and reopens."
        $q = Wait-AppQuit (Get-Date).AddSeconds(60)
        if ($q) { return @{ result = 'quit'; at = $q } }
        $reason = Get-BusyReason $IgnorePatterns
        if (-not $reason) { return @{ result = 'ready' } }
        Log "busy again in the last minute: $reason"
        $last = $reason
        $quiet = 0
      }
    }
    $q = Wait-AppQuit (Get-Date).AddSeconds($IdlePollSeconds)
    if ($q) { return @{ result = 'quit'; at = $q } }
  }
  @{ result = 'gave-up'; reason = "agents kept working (last: $last)" }
}

function Wait-AppBack([int]$Minutes = 15) {
  # T3 is back when its API answers, which is also when its window appears.
  $until = (Get-Date).AddMinutes($Minutes)
  $since = Get-Date
  while ((Get-Date) -lt $until) {
    if ((Test-AppRunning) -and (Test-AppApi)) { return $true }
    if (-not (Test-AppRunning) -and ((Get-Date) - $since).TotalSeconds -gt 60) { Log 'T3 is not running; starting it'; Start-App; $since = Get-Date }
    Start-Sleep -Seconds 3
  }
  $false
}

function Send-Report([string]$ThreadId, [string]$Text) {
  if (-not $ThreadId) { return }
  for ($i = 0; $i -lt 20; $i++) {
    if ($null -ne (Invoke-T3 @('send', $ThreadId, $Text))) { Log "reported to thread $ThreadId"; return }
    Start-Sleep -Seconds 30
  }
  Log "could not report to thread $ThreadId"
}

function Get-RestartIgnore {
  @(@($Ignore) + @((Read-Config).idleIgnore) | Where-Object { $_ } | Select-Object -Unique)
}

function Show-RestartProbe([string]$Exe, [string]$Ver, [string]$ThreadId, [datetime]$Until) {
  $from = Get-InstalledBuild
  $main = Get-AppMain | Select-Object -First 1
  "Installed   $from$($main ? ", running since $($main.CreationDate.ToString('yyyy-MM-dd HH:mm'))" : ', not running')"
  "Target      $Ver ($Exe)"
  $dl = Get-DownloadedUpdate
  "App update  $($dl ? "$dl downloaded by T3; it installs that itself when it quits" : 'nothing downloaded by T3')"
  "Armed       $(Get-ArmedSummary)"
  if ($ThreadId) {
    $threads = Get-Threads
    $t = $threads | Where-Object id -eq $ThreadId | Select-Object -First 1
    $about = $t ? ' "{0}" ({1})' -f $t.title, $t.state : ' (not found)'
    "Thread      $ThreadId$about"
  } else { 'Thread      none (nothing to wait for or report to)' }
  $ign = Get-RestartIgnore
  $busy = Get-BusyReason $ign
  "Busy now    $($busy ? $busy : 'no: no thread mid-turn and no agent tool running')$($ign ? " (ignoring $($ign -join ', '))" : '')"
  $what = if ($from -eq $Ver -and -not $Force) { "nothing: T3 already runs $Ver (-Force restarts it anyway)" }
    elseif ($WhenIdle) { "quit T3 once nothing has been busy for $((Read-Config).idleMinutes ?? 10) minutes (giving up at $($Until.ToString('yyyy-MM-dd HH:mm'))), install $Ver, reopen T3, check it, report" }
    else { "quit T3 once the thread's turn ends (giving up at $($Until.ToString('HH:mm'))), install $Ver, reopen T3, check it, report" }
  "Would do    $what"
}

function Invoke-RestartRun {
  # The one-shot task: wait, quit T3, install, reopen, check, report.
  $req = Get-Content $RestartPath -Raw | ConvertFrom-Json -AsHashtable
  $ver = $req.version
  $until = [datetime]$req.giveUpAt
  $threadId = $req.thread
  $from = Get-InstalledBuild
  $why = $req.whenIdle ? "once no agent has worked for $($req.idleMinutes) minutes" : 'once the requesting turn ends'
  Log "restart T3 from $from into $ver $why; gives up at $($until.ToString('yyyy-MM-dd HH:mm')); reports to $($threadId ? $threadId : 'nobody')"
  try {
    $wait = $req.whenIdle ? (Wait-ForIdle @($req.ignore) $until $ver $req.idleMinutes) : (Wait-ForTurn $threadId $until)
    if ($wait.result -eq 'gave-up') {
      Log "gave up: $($wait.reason)"
      Show-Toast 'T3 Code was not restarted' $wait.reason
      Send-Report $threadId "T3 Code was not restarted into $ver by $($until.ToString('yyyy-MM-dd HH:mm')): $($wait.reason). Arm it again with: pwsh $(Join-Path (Resolve-Repo) 'fork\fork.ps1') restart$($req.whenIdle ? ' -WhenIdle' : '')"
      return
    }
    if ($wait.result -eq 'quit') {
      $closedAt = $wait.at
      Log 'T3 Code quit on its own'
    } else {
      Log 'closing T3 Code'
      Close-App 90
      $closedAt = Get-Date
    }
    [void](Complete-Install $req.installer $ver $closedAt -SkipIfCurrent)
    $back = Wait-AppBack 15
    $installed = Get-InstalledBuild
    $ok = (Compare-Build $installed $ver) -ge 0
    Log "T3 is $($back ? 'back' : 'NOT back after 15 minutes') on $installed$($ok ? '' : ", not $ver")"
    Show-Toast ($ok ? "T3 Code restarted on $installed" : 'T3 Code restart did not finish') ($ok ? "Was $from." : "Installed build reads $installed. Log: $script:RunLog")
    # Give the threads a moment to reconnect before one of them gets a message.
    if ($threadId) { Start-Sleep -Seconds 30 }
    $at = (Get-Date).ToString('HH:mm')
    Send-Report $threadId ($ok -and $back ?
      "T3 Code restarted at $at and runs $installed (was $from). Background jobs that threads had running ended with T3; re-arm any that are still needed. Log: $script:RunLog" :
      "T3 Code restart at $at did not finish: T3 $($back ? 'is back' : 'did not come back') and its installed build reads $installed, not $ver. Log: $script:RunLog")
  } catch {
    Log "FAILED: $_"
    Show-Toast 'T3 Code restart failed' "$_"
    Send-Report $threadId "T3 Code restart failed: $_. Log: $script:RunLog"
  } finally {
    # Whatever happened, never leave T3 closed.
    if (-not (Test-AppRunning)) { Log 'starting T3 Code'; Start-App }
    Remove-Item $RestartPath -Force -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $RestartTaskName -Confirm:$false -ErrorAction SilentlyContinue
  }
}

function Invoke-Restart {
  if ($Cancel) {
    $had = Stop-OneShot $RestartTaskName 'restart'
    Remove-Item $RestartPath -Force -ErrorAction SilentlyContinue
    return ($had ? 'Cancelled the armed restart.' : 'No restart was armed.')
  }
  if ($Now) { Invoke-RestartRun; return }

  $exe = Get-Installer $Version
  $ver = Get-ExeVersion $exe
  $threadId = $Thread ? $Thread : "$(Invoke-T3 @('me', '--id'))".Trim()
  $until = $GiveUpAt ?? (Get-Date).AddHours($WhenIdle ? 12 : 0.5)
  if ($Probe) { Show-RestartProbe $exe $ver $threadId $until; return }
  $from = Get-InstalledBuild
  if ($from -eq $ver -and -not $Force) { return "T3 already runs $ver, the newest fork build. -Force restarts it anyway." }
  if ($WhenIdle -and -not (Get-T3Cli)) { throw "-WhenIdle needs agent-kit's t3 CLI to see thread states (config.json t3Cli, or T3_CLI)." }

  Backup-LiveDb
  if (Stop-OneShot $InstallTaskName 'install') { Log "stopped the waiting install task: the restart installs $ver itself" }
  if (Stop-OneShot $RestartTaskName 'restart') { Log 'replaced the restart that was armed' }
  $idleMinutes = [int]((Read-Config).idleMinutes ?? 10)
  [ordered]@{
    version = $ver; installer = $exe; from = $from; armedAt = (Get-Date).ToString('o'); giveUpAt = $until.ToString('o')
    whenIdle = [bool]$WhenIdle; idleMinutes = $idleMinutes; ignore = @(Get-RestartIgnore); thread = $threadId
  } | ConvertTo-Json | Set-Content $RestartPath -Encoding UTF8
  Register-OneShot 'restart' $RestartTaskName 'restart -Now' (($until - (Get-Date)) + (New-TimeSpan -Hours 1)) "Restarts T3 Code into fork $ver. Cancel: fork.ps1 restart -Cancel. fork/README.md"
  $when = $WhenIdle ? "once no agent has worked for $idleMinutes minutes" : ($threadId ? 'as soon as this thread''s turn ends' : 'in a few seconds')
  Log "Armed: T3 Code restarts $when, installs $ver (now $from), reopens and $($threadId ? "reports to thread $threadId" : 'shows a notification'). Gives up at $($until.ToString('yyyy-MM-dd HH:mm')). Cancel: fork.ps1 restart -Cancel. Log in $LogDir."
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

# Dot-sourced (fork/test-restart.ps1): define the functions only.
if ($MyInvocation.InvocationName -eq '.') { return }

switch ($Command) {
  'sync' { Invoke-Sync }
  'status' { Show-Status }
  'patches' { Show-Patches }
  'merge' { Invoke-ManualMerge }
  'install' { Invoke-Install }
  'restart' { Invoke-Restart }
  'task' { Invoke-Task }
  default { Get-Help $PSCommandPath -Examples | Out-String | Write-Host; 'See fork/README.md.' }
}
