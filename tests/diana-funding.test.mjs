import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fundingFieldsValid,FUNDING} from '../prototypes/diana-payment-account/diana-fund.mjs';
const tx={type:'eip1559',chainId:9800,nonce:5,to:FUNDING.to,value:3000000000000000n,gas:30000n,maxFeePerGas:150000000000n,maxPriorityFeePerGas:12500000000n,data:'0x',accessList:[]};
test('funding is restricted to the exact contract, value, network, nonce, empty call and fee bounds',()=>{
 assert.equal(FUNDING.valueWei,3000000000000000n);assert.equal(fundingFieldsValid(tx,5),true);
 for(const change of [{chainId:1},{to:'0xc9Ab55FeC7c1fEe27F3AFc5DF99E6A09b4B2D875'},{to:undefined},{value:tx.value+1n},{value:tx.value-1n},{nonce:6},{data:'0x1234'},{gas:50001n},{gas:0n},{maxFeePerGas:150000000001n},{maxPriorityFeePerGas:151000000000n},{accessList:[{}]},{authorizationList:[]},{type:'legacy'}])assert.equal(fundingFieldsValid({...tx,...change},5),false,JSON.stringify(change,(_,v)=>typeof v==='bigint'?String(v):v));
});
import {preciseBalanceMatches} from '../prototypes/diana-payment-account/diana-window-prepare.mjs';
test('integer uqor plus independently read aqor fraction must exactly equal EVM wei',()=>{
 assert.equal(preciseBalanceMatches(99651389012500000000n,'99651389',{denom:'aqor',amount:'12500000000'}),true);
 for(const fraction of [{denom:'aqor',amount:'12500000001'},{denom:'uqor',amount:'12500000000'},{denom:'aqor',amount:'1000000000000'},{denom:'aqor',amount:'-1'},undefined])assert.equal(preciseBalanceMatches(99651389012500000000n,'99651389',fraction),false);
 assert.equal(preciseBalanceMatches(1000000000000n,'1',{denom:'aqor',amount:'0'}),true);
});
