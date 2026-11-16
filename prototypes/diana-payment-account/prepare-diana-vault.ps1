param([switch]$InvoicePqc, [string]$InvoiceApproval)

$ErrorActionPreference = 'Stop'
$vault = 'E:\ELA-PRIVATE-VAULT'
$batch = Join-Path $vault 'Diana-9800-accounts'
$roles = 'deployer', 'invoice-owner', 'executor', 'recipient'
try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    if ($identity.Name -match '(?i)codex|sandbox' -or
        $identity.User.Value -eq 'S-1-5-21-2954583569-403137488-2188362351-1004' -or
        'S-1-5-4' -notin $identity.Groups.Value -or
        [Diagnostics.Process]::GetCurrentProcess().SessionId -eq 0 -or
        [Console]::IsInputRedirected) {
        throw 'Run in your interactive Windows account.'
    }
    if ([IO.DriveInfo]::new('E').DriveFormat -ne 'NTFS' -or
        [IO.DriveInfo]::new('E').DriveType -ne [IO.DriveType]::Fixed) {
        throw 'The vault must be on a fixed local NTFS drive.'
    }
    foreach ($path in @('E:\', $vault)) {
        $folder = Get-Item -LiteralPath $path -Force
        if (-not $folder.PSIsContainer -or ($folder.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw 'Invalid or redirected vault path.'
        }
        if (Test-Path -LiteralPath (Join-Path $path '.git')) { throw 'Git metadata at vault or drive root.' }
    }
    if (-not ((Get-Item -LiteralPath $vault -Force).Attributes -band [IO.FileAttributes]::Encrypted)) {
        throw 'EFS is required on the vault.'
    }
    $acl = Get-Acl -LiteralPath $vault
    if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $identity.User.Value) {
        throw 'The vault must belong to the interactive account.'
    }
    $trusted = @($identity.User.Value, 'S-1-5-18', 'S-1-5-32-544')
    foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
        if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin $trusted) {
            throw 'The vault grants access to another identity.'
        }
    }
    if ($InvoicePqc) {
        $file = Join-Path $vault 'invoice-owner.diana-9800.mldsa87'
        if (Test-Path -LiteralPath $file) { throw 'An Invoice Owner PQC file already exists.' }
        if ($InvoiceApproval -cne 'GENERATE DIANA INVOICE PQC') {
            throw 'Generation approval was not entered.'
        }
        $stream = [IO.File]::Open($file, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
        $stream.Dispose()
        $item = Get-Item -LiteralPath $file -Force
        if (-not ($item.Attributes -band [IO.FileAttributes]::Encrypted) -or
            ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.Length -ne 0) {
            throw 'EFS verification failed on the empty PQC destination.'
        }
        exit 0
    }

    if (Test-Path -LiteralPath $batch) { throw 'An account batch already exists.' }

    Write-Host 'Four independent roles will be created for Diana 9800.'
    Write-Host 'EFS vault: E:\ELA-PRIVATE-VAULT\Diana-9800-accounts'
    Write-Host 'Independent EFS backup recovery has not been verified.'
    if ((Read-Host 'Type GENERATE DIANA TEST ACCOUNTS') -cne 'GENERATE DIANA TEST ACCOUNTS') {
        throw 'Generation approval was not entered.'
    }

    New-Item -ItemType Directory -Path $batch | Out-Null
    if (-not ((Get-Item -LiteralPath $batch).Attributes -band [IO.FileAttributes]::Encrypted)) {
        throw 'EFS did not carry over to the account directory.'
    }
    foreach ($role in $roles) {
        foreach ($kind in @('v3', 'recovery')) {
            $file = Join-Path $batch "$role.$kind.json"
            $stream = [IO.File]::Open($file, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
            $stream.Dispose()
            $item = Get-Item -LiteralPath $file -Force
            if (-not ($item.Attributes -band [IO.FileAttributes]::Encrypted) -or
                ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.Length -ne 0) {
                throw 'EFS verification failed on an empty destination file.'
            }
        }
    }
} catch {
    [Console]::Error.WriteLine('Vault gate stopped. ' + $_.Exception.Message)
    exit 1
}
