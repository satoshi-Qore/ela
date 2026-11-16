import { createInterface } from 'node:readline';
import { qoreAddresses } from '@qorechain/sdk';

export const NATIVE_CHAIN = 'qorechain-diana';

export function validateInvoiceOwner(native, evm) {
  const addresses = qoreAddresses({ cosmos: native });
  if (addresses.cosmos !== native || !/^0x[0-9a-f]{40}$/i.test(evm)
      || addresses.evm.toLowerCase() !== evm.toLowerCase()) {
    throw new Error('Native and EVM addresses must match');
  }
  return { native: addresses.cosmos, evm: addresses.evm };
}


export async function promptForInvoiceOwner(input, output) {
  const prompt = createInterface({ input, output });
  const lines = prompt[Symbol.asyncIterator]();
  async function ask(label) {
    output.write(label);
    const answer = await lines.next();
    if (answer.done) throw new Error('Input ended before confirmation');
    return answer.value;
  }

  try {
    const native = (await ask('Invoice Owner public Native address (qor1...): ')).trim();
    const evm = (await ask('Invoice Owner public EVM address (0x...): ')).trim();
    const owner = validateInvoiceOwner(native, evm);
    output.write('Diana Invoice Owner: ' + owner.native + ' / ' + owner.evm + '\n');
    const approval = await ask('Type GENERATE DIANA INVOICE PQC: ');
    if (approval !== 'GENERATE DIANA INVOICE PQC') throw new Error('Generation approval was not entered');
    return { owner, approval };
  } finally {
    prompt.close();
  }
}
