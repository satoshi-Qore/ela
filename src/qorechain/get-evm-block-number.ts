import { isRecord, QORECHAIN_TESTNET, QoreChainReadError, readJson } from './read-client.ts';
import type { ReadOptions } from './read-client.ts';

const evmEndpoint = 'https://evm-testnet.qore.host/';
const dianaChainHex = '0x2648';

type ReadMethod = 'eth_chainId' | 'eth_blockNumber';

async function request(method: ReadMethod, id: number, options: ReadOptions): Promise<string> {
  const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params: [] });
  const body = await readJson(new URL(evmEndpoint), options, payload);
  if (!isRecord(body) || body.jsonrpc !== '2.0' || body.id !== id || 'error' in body
    || typeof body.result !== 'string') {
    throw new QoreChainReadError('invalid_response', 'Invalid EVM JSON-RPC response for ' + method + '.');
  }
  return body.result;
}

export async function getEvmBlockNumber(options: ReadOptions = {}): Promise<{
  chainId: string;
  evmChainId: string;
  blockNumber: string;
}> {
  const chain = await request('eth_chainId', 1, options);
  if (chain !== dianaChainHex) {
    throw new QoreChainReadError('chain_mismatch', 'EVM JSON-RPC did not report the Diana testnet chain ID (9800).');
  }

  const height = await request('eth_blockNumber', 2, options);
  if (!/^0x(?:0|[1-9a-f][0-9a-f]*)$/u.test(height)) {
    throw new QoreChainReadError('invalid_response', 'Invalid EVM block height.');
  }
  return {
    chainId: QORECHAIN_TESTNET.chainId,
    evmChainId: BigInt(chain).toString(),
    blockNumber: BigInt(height).toString(),
  };
}
