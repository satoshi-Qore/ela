import type { ConversationContext } from './conversation.ts';
import { foldCommand, interpretCommand } from './intent.ts';
import type { DecisionThresholds, IntentCandidate, IntentClassifier, IntentDecision, IntentLabel } from './intent.ts';

/**
 * Deterministic Turkish and English understanding for the Diana testnet read-only queries. It is a
 * rule-based `IntentClassifier`: no model, no dependency, no network access. It plugs into the
 * existing classifier slot, so the safety gate, network and parameter checks run before it, and its
 * output is validated by `decideIntent` like any classifier's.
 *
 * Every word of a sentence must be known to the lexicon. One unknown word ("kimdir", "who",
 * "transfer", a number, a name) makes it answer `unknown`, which leads to clarification. This keeps
 * the rules narrow: a sentence is only understood when all of it is understood.
 */

type Category =
  | 'net' // the Diana network: diana, qorechain, testnet, ağ, network, chain ...
  | 'status' // health predicates: çalışıyor, ayakta, up, online, working ...
  | 'weak_status' // predicates that also fit people: ok, fine, alive, hazır ...
  | 'check' // check verbs: kontrol et, bak, check, verify, ping ...
  | 'block' // blok, block
  | 'height_word' // yükseklik, height (implies the block height)
  | 'height' // numara, sayı, number
  | 'latest' // son, güncel, latest, current ...
  | 'ordinal' // kaçıncı (which block are we on)
  | 'kac' // kaç
  | 'wh' // ne, nedir, what, which ...
  | 'how' // nasıl, how
  | 'show' // göster, söyle, show, tell, get ...
  | 'repeat' // tekrar, bir daha, again, refresh ...
  | 'still' // hâlâ, still
  | 'now' // şimdi, artık, now ...
  | 'became' // oldu, olmuş
  | 'filler' // politeness, question particles, articles
  | 'unsupported'; // read topics ELA cannot answer: fees, balances, transactions, hashes ...

// All patterns run on folded text (lower case, Turkish letters as ASCII, no punctuation).
const LEXICON: ReadonlyArray<readonly [Category, string]> = [
  ['net', 'qore ?chain(?:in|i|e|de|deki|un|s)?'],
  ['net', 'diana(?:yi|ya|da|daki|dan|nin|in|yla|s)?'],
  ['net', 'test ?net(?:i|in|ini|inin|e|te|teki|de|deki|ten|s)?'],
  ['net', 'test ?ag(?:i|in|ini|inin|inda|indaki|da|daki|a)?'],
  ['net', 'ag(?:i|in|ini|inin|inda|indaki|da|daki|a)?'],
  // Within one entry the first alternative that ends at a word boundary wins, so phrases that start
  // with another entry's word ("zincir kimliği", "chain id") are separate entries; across entries
  // the longest match wins.
  ['net', 'zincir(?:i|in|e|de)?|chain|blockchain|networks?'],
  ['net', 'zincir kimlig(?:i|ini)|chain ?id'],
  ['net', 'rpc|endpoint|uc nokta(?:si|sini)?|node|baglanti(?:si|sini|yi)?|connection'],

  ['status', 'calisiyor|calisiyo|calisir|ayakta|aktif|saglikli|erisilebilir|erisilebiliyor|ulasilabilir|cevrimici|cevap veriyor|yanit veriyor'],
  ['status', 'durum(?:u|unu|una|da)?|sorun var|sorunsuz|dogru|baglanabiliyor|yolunda'],
  ['status', 'working|running|up|online|healthy|health|reachable|available|responding|responsive|down|status|operational|correct|synced'],
  ['weak_status', 'ok|okay|fine|alive|live|canli|hazir'],

  ['check', 'kontrol (?:et|etsene|edin|ediniz|edelim|eder|edebilir|ediver)'],
  ['check', 'test (?:et|eder|edebilir|edin)|yokla(?:r|yabilir|yin)?|bak(?:ar|abilir|in|sana|iver)?'],
  ['check', 'sorgula(?:r|yabilir|yin)?|denetle(?:r|yebilir|yin)?|dene(?:r|yebilir|yin)?'],
  ['check', 'check(?:s)?(?: on| up on)?|ping|verify|test|look(?: at| into)?|inspect|query|try|probe'],

  ['block', 'blo[kg](?:u|un|unu|a|da|ta|taki|tayiz|tayim|lar|lari)?|blocks?'],
  ['height_word', 'yukseklik|yukseklig(?:i|ini|in)|height'],
  ['height', 'numara(?:si|sini)?|sayi(?:si|sini)?|number'],
  ['latest', 'son|en son|en guncel|guncel|en yeni|simdiki|su anki|mevcut|latest|current|newest|most recent|recent|last'],
  ['ordinal', 'kacinci|kacta'],
  ['kac', 'kac'],
  ['wh', 'ne|nedir|hangisi|hangi|what|whats|which'],
  ['how', 'nasil|how'],

  ['show', 'goster(?:ir|ebilir|in)?|soyle(?:r|yebilir|yin)?|ogren(?:ebilir|mek)?|getir(?:ir|ebilir)?|ver(?:ir|ebilir)?|bildir'],
  ['show', 'show|tell|give|get|fetch|display|read|find|report|say|see|look up|pull up'],

  ['repeat', 'tekrar(?:dan)?|tekrarla|yeniden|bir daha|bir kez daha|bir kere daha|guncelle|yenile'],
  ['repeat', 'again|once more|one more time|once again|retry|re ?check|refresh|redo|re ?run'],
  ['still', 'hala|still'],
  ['now', 'simdi|su an|su anda|artik|now|right now|currently|at the moment|at present'],
  ['became', 'oldu|olmus'],

  ['filler', 'lutfen|peki|acaba|hey|ela|bana|bize|benim icin|bir|hemen|hizlica|istiyorum'],
  ['filler', 'mi|mu|misin|musun|misiniz|musunuz|miyim|muyum|miyiz|muyuz|midir|mudur'],
  ['filler', 'please|pls|plz|kindly|hi|hello|can|could|would|will|you|u|me|us|for me|for|the|a|an|is|are|was'],
  ['filler', 'its|it|of|on|in|at|to|do|does|i|id|like|want|know|let|lets|just|quickly|quick|so|and|about|if|whether|we|from|doing'],

  ['unsupported', 'bakiye[a-z]*|balance[a-z]*|odul[a-z]*|rewards?|ucret[a-z]*|fees?|gas|validator[a-z]*|validat[a-z]*|dogrulayici[a-z]*'],
  ['unsupported', 'faucet|hash[a-z]*|fiyat[a-z]*|price[a-z]*|islem[a-z]*|transactions?|txs?|sure(?:si|sini)?|time|zaman[a-z]*'],
  ['unsupported', 'boyut[a-z]*|size|explorer|adres[a-z]*|address[a-z]*|stake orani|apr|apy|supply|arz[a-z]*'],
];

const ENTRIES: ReadonlyArray<readonly [Category, RegExp]> = LEXICON.map(([category, body]) => [category, new RegExp('(?:' + body + ')(?= |$)', 'y')] as const);

/** Splits folded text into lexicon categories, longest match first. Undefined if a word is unknown. */
function scan(text: string): Category[] | undefined {
  const found: Category[] = [];
  let position = 0;
  while (position < text.length) {
    let length = 0;
    let category: Category | undefined;
    for (const [candidate, pattern] of ENTRIES) {
      pattern.lastIndex = position;
      const match = pattern.exec(text);
      if (match && match[0].length > length) {
        length = match[0].length;
        category = candidate;
      }
    }
    if (!category) return undefined;
    found.push(category);
    position += length + 1;
  }
  return found;
}

/** Bare "Diana" may be a person; only network words make weak predicates ("ok", "alive") a check. */
const networkWord = /(?<![a-z])(?:qore ?chain|test ?net|test ?ag|ag|zincir|chain|blockchain|network|rpc|endpoint|node|uc nokta|baglanti|connection)/u;

/** Picks one label for folded text, or `unknown`. Exported for tests. */
export function labelOf(text: string): IntentLabel {
  if (text === '') return 'unknown';
  const categories = scan(text);
  if (!categories) return /(?<![a-z])(?:bakiye|balance|odul|reward|ucret|fee|gas|validat|faucet|hash|islem|transaction|explorer)/u.test(text) ? 'unsupported' : 'unknown';
  const has = new Set(categories);
  if (has.has('unsupported')) return 'unsupported';

  const blockish = has.has('block') || has.has('height_word');
  if (blockish) {
    if (has.has('status') || has.has('weak_status') || has.has('still')) return 'unknown';
    if (has.has('block') && !(has.has('latest') || has.has('height') || has.has('height_word') || has.has('ordinal'))) return 'unknown';
    return 'block_number';
  }
  if (has.has('net')) {
    if (has.has('status') || has.has('check')) return 'network_check';
    // "How is the Diana network?" asks for its state; "How is Diana?" may be about a person.
    if ((has.has('weak_status') || has.has('how')) && networkWord.test(text)) return 'network_check';
    return 'unknown';
  }
  if (has.has('repeat') && !has.has('wh') && !has.has('kac') && !has.has('how')) return 'follow_up_repeat';
  if (has.has('still') && (has.has('status') || has.has('weak_status'))) return 'follow_up_repeat';
  const onlyCurrent = categories.every(category => category === 'now' || category === 'became' || category === 'kac' || category === 'wh' || category === 'how' || category === 'filler');
  if (onlyCurrent && (has.has('now') || (has.has('became') && has.has('kac')))) return 'follow_up_current';
  return 'unknown';
}

/**
 * Rule-based classifier. It reports one candidate with score 1 for a full lexicon match, or
 * `unknown` with score 1. The score is a rule decision, not a measured probability.
 */
export const ruleClassifier: IntentClassifier = Object.freeze({
  classify(text: string): IntentCandidate[] {
    const label = typeof text === 'string' ? labelOf(foldCommand(text)) : 'unknown';
    return [{ label, score: 1 }];
  },
});

export interface UnderstandOptions {
  readonly thresholds?: DecisionThresholds;
}

/**
 * Understands a Turkish or English command with the rule-based classifier. Risky requests are
 * refused by the safety gate before the classifier sees them. Nothing is sent: pass a `run`
 * decision to `actOnDecision` to read fresh data through the tool registry.
 */
export function understandCommand(command: unknown, context: ConversationContext | undefined, options: UnderstandOptions = {}): Promise<IntentDecision> {
  return interpretCommand(command, context, { ...options, classifier: ruleClassifier });
}
