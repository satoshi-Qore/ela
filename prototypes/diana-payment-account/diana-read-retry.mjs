// Transport resilience only. Never repeat a transaction submission or unknown method.
const RPC_READS=new Set(['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_getBlockByHash','eth_getTransactionCount','eth_getBalance','eth_gasPrice','eth_estimateGas','eth_getCode','eth_call','eth_getTransactionByHash','eth_getTransactionReceipt']);
export function withDianaReadRetries(fetchImpl=globalThis.fetch,{sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
  return async(url,init={})=>{
    const target=new URL(String(url)),method=(init.method??'GET').toUpperCase();
    const pinned=target.protocol==='https:'&&['api-testnet.qore.host','evm-testnet.qore.host'].includes(target.host);
    let read=pinned&&method==='GET';
    if(pinned&&method==='POST'){
      if(target.host==='api-testnet.qore.host'&&target.pathname==='/cosmos/tx/v1beta1/simulate')read=true;
      else if(target.host==='evm-testnet.qore.host')try{read=RPC_READS.has(JSON.parse(init.body).method);}catch{}
    }
    const attempts=read?3:1;
    for(let i=0;i<attempts;i++){
      try{
        const response=await fetchImpl(url,init);
        if(!read||![429,502,503,504].includes(response.status)||i===attempts-1||init.signal?.aborted)return response;
        try{await response.body?.cancel();}catch{}
      }catch(error){if(!read||i===attempts-1||init.signal?.aborted)throw error;}
      await sleep(i===0?150:400);
    }
  };
}
