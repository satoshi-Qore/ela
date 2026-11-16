$ErrorActionPreference = 'Stop'

try {
    $evm = Invoke-RestMethod -Uri 'https://evm-testnet.qore.host/' -Method Post `
        -ContentType 'application/json' -TimeoutSec 15 -MaximumRedirection 0 `
        -Body '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
    if ($null -ne $evm.error -or $evm.jsonrpc -cne '2.0' -or $evm.id -ne 1 -or $evm.result -cne '0x2648') {
        throw 'EVM chain ID could not be verified as Diana (9800).'
    }

    $native = Invoke-RestMethod -Uri 'https://rpc-testnet.qore.host/status' -Method Get `
        -TimeoutSec 15 -MaximumRedirection 0
    if ($null -ne $native.error -or $native.result.node_info.network -cne 'qorechain-diana' -or
        $native.result.sync_info.catching_up -isnot [bool] -or $native.result.sync_info.catching_up) {
        throw 'Native endpoint did not report a synchronized Diana node.'
    }
} catch {
    throw ('Diana preflight blocked. ' + $_.Exception.Message)
}

[pscustomobject]@{
    EvmChainId = 9800
    NativeChainId = 'qorechain-diana'
    NativeHeight = $native.result.sync_info.latest_block_height
}
