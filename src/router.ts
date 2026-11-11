export type Network = 'mainnet' | 'testnet';

/** Inputs supplied by the caller after user confirmation and network-specific validation. */
export interface VerifiedInputs {
  readonly address?: string;
  readonly amount?: string;
  readonly network?: Network;
}

type Tool = 'get_balance' | 'get_block_number' | 'prepare_transfer';
type ClarificationReason =
  | 'ambiguous_command'
  | 'multiple_intents'
  | 'missing_address'
  | 'missing_amount'
  | 'missing_network'
  | 'conflicting_address'
  | 'conflicting_amount'
  | 'conflicting_network';

export type RoutingResult =
  | { kind: 'needs_clarification'; reason: ClarificationReason }
  | { kind: 'route'; tool: 'get_balance'; address: string; network?: Network }
  | { kind: 'route'; tool: 'get_block_number'; network?: Network }
  | { kind: 'route'; tool: 'prepare_transfer'; address: string; amount: string; network: Network };

interface Match {
  tool: Tool;
  address?: string;
  amount?: string;
  network?: Network;
}

const negatedCommands = new Map<string, Tool>([
  ['transfer yapma', 'prepare_transfer'],
  ['transfer hazırlama', 'prepare_transfer'],
  ['bakiyeyi sorgulama', 'get_balance'],
  ['bakiyeyi gösterme', 'get_balance'],
  ['son blok numarasını öğrenme', 'get_block_number'],
  ['son blok numarasını gösterme', 'get_block_number'],
]);

const balancePattern = /^(?:qorechain )?(?:bakiyeyi|(?:adres )?bakiyesini) (?:göster|sorgula|öğren|kontrol et)$/u;
const blockPattern = /^(?:qorechain )?(?:(?:en güncel|en son|son) )?blok (?:numarası (?:kaç|nedir)|yüksekliği (?:kaç|nedir)|(?:numarasını|yüksekliğini) (?:göster|sorgula|öğren))$/u;
const transferPattern = /^(?:(\d+(?:[.,]\d+)?) (test )?qor )?(?:(?:transferi|göndermek) için (?:işlem(?: taslağı)?|transfer taslağı|taslak) |(?:transfer|işlem) taslağı )(?:hazırla|oluştur)$/u;

function clarify(reason: ClarificationReason): RoutingResult {
  return { kind: 'needs_clarification', reason };
}

function normalize(text: string): string {
  return text.normalize('NFC').toLocaleLowerCase('tr');
}

function canonicalAmount(amount: string | undefined): string | undefined {
  if (typeof amount !== 'string' || !/^\d+(?:[.,]\d+)?$/u.test(amount)) return undefined;
  const [whole, fraction = ''] = amount.replace(',', '.').split('.');
  const integer = whole.replace(/^0+(?=\d)/u, '');
  const decimals = fraction.replace(/0+$/u, '');
  if (decimals) return integer + '.' + decimals;
  return integer === '0' ? undefined : integer;
}

function matchClause(clause: string): Match | undefined {
  const words = clause.split(' ');
  if (/^(?:sadece|yalnızca)$/u.test(normalize(words[0]))) words.shift();
  let text = normalize(words.join(' '));
  const networkPrefix = /^(?:(?:qorechain )?test ağında|(?:qorechain )?ana ağda|testnet(?:te)?|mainnet(?:te)?) /u.exec(text);
  let network: Network | undefined;
  if (networkPrefix) {
    network = networkPrefix[0].includes('test') ? 'testnet' : 'mainnet';
    words.splice(0, networkPrefix[0].trim().split(' ').length);
    text = normalize(words.join(' '));
  }

  const reference = /^(?:bu|seçili) (adresin|adrese|adreste) /u.exec(text);
  const explicit = /^(\S+) (adresinin|adresine) /u.exec(text);
  const address = explicit ? words[0] : undefined;
  const addressRole = reference?.[1] ?? explicit?.[2];
  const intentText = text.slice((reference ?? explicit)?.[0].length ?? 0);

  if ((!addressRole || /^(?:adresin|adresinin|adreste)$/u.test(addressRole))
    && (balancePattern.test(intentText) || intentText === 'ne kadar qor var')) {
    return { tool: 'get_balance', address, network };
  }
  if (!addressRole && blockPattern.test(intentText)) return { tool: 'get_block_number', network };

  const transfer = transferPattern.exec(intentText);
  if (!transfer || (addressRole && addressRole !== 'adrese' && addressRole !== 'adresine')) return undefined;
  if (transfer[2] && network === 'mainnet') return undefined;
  return { tool: 'prepare_transfer', address, amount: transfer[1], network: transfer[2] ? 'testnet' : network };
}

export function routeCommand(command: string, verified: VerifiedInputs = {}): RoutingResult {
  const clauses = command.trim().replace(/\s+/gu, ' ')
    .split(/(?<!\d),|,(?!\d)|[;!?]+|(?<!\d)\.|\.(?!\d)|\s+ve\s+/iu)
    .map(clause => clause.trim()).filter(Boolean);
  const denied = new Set<Tool>();
  const matches: Match[] = [];
  for (const clause of clauses) {
    const negated = negatedCommands.get(normalize(clause));
    if (negated) {
      denied.add(negated);
      continue;
    }
    const match = matchClause(clause);
    if (!match) return clarify('ambiguous_command');
    matches.push(match);
  }

  const intents = new Set(matches.map(match => match.tool));
  if (intents.size > 1) return clarify('multiple_intents');
  const match = matches[0];
  if (matches.length !== 1 || !match || denied.has(match.tool)) return clarify('ambiguous_command');
  if (match.network && verified.network && match.network !== verified.network) return clarify('conflicting_network');
  const network = verified.network ?? match.network;
  const networkField = network ? { network } : {};
  if (match.tool === 'get_block_number') return { kind: 'route', tool: match.tool, ...networkField };

  const address = verified.address;
  if (typeof address !== 'string' || !/^\S+$/u.test(address)) return clarify('missing_address');
  if (match.address !== undefined && match.address !== address) return clarify('conflicting_address');
  if (match.tool === 'get_balance') return { kind: 'route', tool: match.tool, address, ...networkField };

  const amount = canonicalAmount(verified.amount);
  if (!amount) return clarify('missing_amount');
  if (match.amount !== undefined && canonicalAmount(match.amount) !== amount) return clarify('conflicting_amount');
  if (verified.network !== 'mainnet' && verified.network !== 'testnet') return clarify('missing_network');
  return { kind: 'route', tool: match.tool, address, amount, network: verified.network };
}
