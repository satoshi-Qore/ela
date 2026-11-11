import { endpoint, isRecord, QORECHAIN_TESTNET, QoreChainReadError, readJson } from './read-client.ts';
import type { ReadOptions } from './read-client.ts';

export interface BlockNumberOptions extends ReadOptions {
  rpcUrl?: string;
}

export async function getBlockNumber(options: BlockNumberOptions = {}): Promise<{ chainId: string; blockNumber: string }> {
  const url = endpoint(options.rpcUrl ?? QORECHAIN_TESTNET.rpcUrl, 'status');
  const body = await readJson(url, options);
  if (!isRecord(body) || body.jsonrpc !== '2.0' || body.error != null || !isRecord(body.result)) {
    throw new QoreChainReadError('invalid_response', 'Invalid consensus RPC status response.');
  }

  const { node_info: node, sync_info: sync } = body.result;
  if (!isRecord(node) || typeof node.network !== 'string' || !isRecord(sync)
    || typeof sync.latest_block_height !== 'string' || !/^[1-9]\d*$/.test(sync.latest_block_height)
    || typeof sync.catching_up !== 'boolean') {
    throw new QoreChainReadError('invalid_response', 'Consensus RPC response is missing valid chain or height information.');
  }
  if (node.network !== QORECHAIN_TESTNET.chainId) {
    throw new QoreChainReadError('chain_mismatch', 'Consensus RPC did not report the QoreChain Diana testnet.');
  }
  if (sync.catching_up) {
    throw new QoreChainReadError('node_syncing', 'The consensus node is still catching up.');
  }
  return { chainId: node.network, blockNumber: sync.latest_block_height };
}
