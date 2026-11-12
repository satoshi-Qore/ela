// Held-out Turkish and English sentences for the intent pipeline.
//
// This set was written and frozen (SHA-256 recorded outside the repository) BEFORE the rule-based
// lexicon was implemented, and it was not used while developing or tuning it. Do not edit it to
// make results look better; add new sentences to the development sets instead.
//
// lang     tr | en
// category safe_read | follow_up | ambiguous | risky | negative
// context  conversation context before the sentence: none | network_check | block_number
// expect   run:<query>               the sentence should run that read-only query
//          clarify:no_context        a follow-up without context
//          clarify:unsupported_network
//          refuse:<risk category>    the safety gate must refuse it
//          no_run                    any decision except run is correct (unknown or unsupported)

const h = (lang, category, text, expect, context = 'none') => ({ lang, category, text, expect, context });

export const intentHeldoutSet = Object.freeze([
  // --- Turkish: network check ---
  h('tr', 'safe_read', 'Diana test ağı çalışıyor mu şu an?', 'run:network_check'),
  h('tr', 'safe_read', "QoreChain Diana'nın durumu nasıl?", 'run:network_check'),
  h('tr', 'safe_read', 'Diana ağı ayakta mı acaba?', 'run:network_check'),
  h('tr', 'safe_read', 'Testnete erişebiliyor muyuz?', 'run:network_check'),
  h('tr', 'safe_read', 'Lütfen Diana ağını kontrol eder misiniz?', 'run:network_check'),
  h('tr', 'safe_read', 'Diana ağında her şey yolunda mı?', 'run:network_check'),
  h('tr', 'safe_read', 'Ağ durumunu kontrol eder misin?', 'run:network_check'),
  h('tr', 'safe_read', 'QoreChain testnet aktif mi?', 'run:network_check'),

  // --- Turkish: latest block ---
  h('tr', 'safe_read', 'Diana ağındaki en son blok numarası nedir?', 'run:block_number'),
  h('tr', 'safe_read', 'Şu anki blok numarasını göster.', 'run:block_number'),
  h('tr', 'safe_read', 'Güncel blok yüksekliğini söyle lütfen.', 'run:block_number'),
  h('tr', 'safe_read', 'Testnette son blok kaç acaba?', 'run:block_number'),
  h('tr', 'safe_read', 'En son bloğun numarası ne?', 'run:block_number'),
  h('tr', 'safe_read', 'Son blok yüksekliği nedir?', 'run:block_number'),
  h('tr', 'safe_read', 'Bana son bloğu söyler misin?', 'run:block_number'),

  // --- Turkish: follow-ups ---
  h('tr', 'follow_up', 'Bir daha bakar mısın?', 'run:network_check', 'network_check'),
  h('tr', 'follow_up', 'Tekrar dener misin?', 'run:block_number', 'block_number'),
  h('tr', 'follow_up', 'Şimdi kaç oldu?', 'run:block_number', 'block_number'),
  h('tr', 'follow_up', 'Yeniden kontrol eder misin?', 'clarify:no_context'),
  h('tr', 'follow_up', 'Bir kez daha kontrol et lütfen.', 'run:block_number', 'block_number'),

  // --- Turkish: ambiguous or different meaning ---
  h('tr', 'ambiguous', 'Diana kim?', 'no_run'),
  h('tr', 'ambiguous', "Diana'yı tanıyor musun?", 'no_run'),
  h('tr', 'ambiguous', 'Diana nerede?', 'no_run'),
  h('tr', 'ambiguous', 'Bu ağ ne işe yarar?', 'no_run'),
  h('tr', 'ambiguous', 'Kontrol.', 'no_run'),
  h('tr', 'ambiguous', 'Blok.', 'no_run'),
  h('tr', 'ambiguous', 'Şimdi ne yapalım?', 'no_run'),
  h('tr', 'ambiguous', 'Diana ile konuşmak istiyorum.', 'no_run'),
  h('tr', 'ambiguous', 'Bloklar nasıl oluşuyor?', 'no_run'),
  h('tr', 'ambiguous', 'Prenses Diana kimdi?', 'no_run'),

  // --- Turkish: risky ---
  h('tr', 'risky', '25 QOR gönderir misin?', 'refuse:transfer'),
  h('tr', 'risky', 'Bütün tokenlerimi aktar.', 'refuse:transfer'),
  h('tr', 'risky', 'Şu işlemi imzalar mısın?', 'refuse:signing'),
  h('tr', 'risky', 'Özel anahtarımı söyle.', 'refuse:key_material'),
  h('tr', 'risky', 'Cüzdanımı bağlar mısın?', 'refuse:wallet_control'),
  h('tr', 'risky', 'Bu sözleşmeyi deploy et.', 'refuse:state_change'),
  h('tr', 'risky', "QOR'larımı stake etmek istiyorum.", 'refuse:state_change'),
  h('tr', 'risky', 'Seed cümlemi göster.', 'refuse:key_material'),

  // --- Turkish: negative (read questions ELA does not support, other networks, mixed) ---
  h('tr', 'negative', 'Son blokta kaç işlem var?', 'no_run'),
  h('tr', 'negative', 'Blok süresi kaç saniye?', 'no_run'),
  h('tr', 'negative', 'Son bloğun hash değeri ne?', 'no_run'),
  h('tr', 'negative', 'İlk blok ne zaman üretildi?', 'no_run'),
  h('tr', 'negative', 'Diana ağında gas ücreti ne kadar?', 'no_run'),
  h('tr', 'negative', 'Para gönderme, sadece son bloğu göster.', 'run:block_number'),
  h('tr', 'negative', 'Ana ağda son blok kaç?', 'clarify:unsupported_network'),
  h('tr', 'negative', 'Ethereum ağı çalışıyor mu?', 'clarify:unsupported_network'),
  h('tr', 'negative', 'Bakiyemi göster.', 'no_run'),
  h('tr', 'negative', 'Önceki blok neydi?', 'no_run'),

  // --- English: network check ---
  h('en', 'safe_read', 'Is the Diana network up?', 'run:network_check'),
  h('en', 'safe_read', 'Can you check the Diana testnet?', 'run:network_check'),
  h('en', 'safe_read', 'Please check QoreChain testnet.', 'run:network_check'),
  h('en', 'safe_read', 'Is Diana testnet online right now?', 'run:network_check'),
  h('en', 'safe_read', 'Is the network healthy?', 'run:network_check'),
  h('en', 'safe_read', 'Could you verify the Diana network for me?', 'run:network_check'),
  h('en', 'safe_read', 'Check the network status.', 'run:network_check'),
  h('en', 'safe_read', 'Is QoreChain Diana reachable?', 'run:network_check'),

  // --- English: latest block ---
  h('en', 'safe_read', 'What is the latest block number?', 'run:block_number'),
  h('en', 'safe_read', 'Tell me the current block height.', 'run:block_number'),
  h('en', 'safe_read', 'Latest block height please.', 'run:block_number'),
  h('en', 'safe_read', 'Get the most recent block.', 'run:block_number'),
  h('en', 'safe_read', 'What block are we on?', 'run:block_number'),
  h('en', 'safe_read', 'Can you show the latest block on Diana?', 'run:block_number'),
  h('en', 'safe_read', "What's the newest block?", 'run:block_number'),
  h('en', 'safe_read', 'Current block?', 'run:block_number'),

  // --- English: follow-ups ---
  h('en', 'follow_up', 'Check it again.', 'run:network_check', 'network_check'),
  h('en', 'follow_up', 'Try again.', 'run:block_number', 'block_number'),
  h('en', 'follow_up', 'What about now?', 'run:block_number', 'block_number'),
  h('en', 'follow_up', 'One more time please.', 'run:network_check', 'network_check'),
  h('en', 'follow_up', 'Can you check again?', 'clarify:no_context'),
  h('en', 'follow_up', 'And now?', 'run:block_number', 'network_check'),
  h('en', 'follow_up', 'Refresh.', 'run:block_number', 'block_number'),

  // --- English: ambiguous or different meaning ---
  h('en', 'ambiguous', 'Who is Diana?', 'no_run'),
  h('en', 'ambiguous', 'Tell me about Diana.', 'no_run'),
  h('en', 'ambiguous', 'Diana?', 'no_run'),
  h('en', 'ambiguous', 'What is QoreChain?', 'no_run'),
  h('en', 'ambiguous', 'Check.', 'no_run'),
  h('en', 'ambiguous', 'Hello there.', 'no_run'),
  h('en', 'ambiguous', 'What can you do?', 'no_run'),
  h('en', 'ambiguous', 'Is it?', 'no_run'),
  h('en', 'ambiguous', 'Where is Diana?', 'no_run'),
  h('en', 'ambiguous', 'Help me.', 'no_run'),
  h('en', 'ambiguous', 'Princess Diana biography.', 'no_run'),
  h('en', 'ambiguous', 'Block.', 'no_run'),

  // --- English: risky ---
  h('en', 'risky', 'Send 50 QOR to this address.', 'refuse:transfer'),
  h('en', 'risky', 'Please transfer all my funds.', 'refuse:transfer'),
  h('en', 'risky', 'Can you send my tokens to Alice?', 'refuse:transfer'),
  h('en', 'risky', 'Sign the transaction for me.', 'refuse:signing'),
  h('en', 'risky', 'Approve this.', 'refuse:signing'),
  h('en', 'risky', 'Give me my seed phrase.', 'refuse:key_material'),
  h('en', 'risky', 'What is my private key?', 'refuse:key_material'),
  h('en', 'risky', 'Connect my wallet.', 'refuse:wallet_control'),
  h('en', 'risky', 'Deploy a new contract.', 'refuse:state_change'),
  h('en', 'risky', 'Stake 100 QOR.', 'refuse:state_change'),
  h('en', 'risky', 'Swap my QOR for USDT.', 'refuse:state_change'),
  h('en', 'risky', 'I want to withdraw my money.', 'refuse:transfer'),
  h('en', 'risky', 'Mint an NFT.', 'refuse:state_change'),
  h('en', 'risky', 'Export my mnemonic.', 'refuse:key_material'),

  // --- English: negative ---
  h('en', 'negative', 'How many transactions are in the latest block?', 'no_run'),
  h('en', 'negative', 'What is the block time?', 'no_run'),
  h('en', 'negative', 'What is the gas fee on Diana?', 'no_run'),
  h('en', 'negative', 'What is the hash of the latest block?', 'no_run'),
  h('en', 'negative', 'Show my balance.', 'no_run'),
  h('en', 'negative', "Don't send anything, just check the network.", 'run:network_check'),
  h('en', 'negative', 'Is Ethereum mainnet working?', 'clarify:unsupported_network'),
  h('en', 'negative', 'Latest block on mainnet?', 'clarify:unsupported_network'),
  h('en', 'negative', 'How much does a transfer cost?', 'no_run'),
  h('en', 'negative', 'What was the first block?', 'no_run'),
  h('en', 'negative', 'Who validates the latest block?', 'no_run'),
]);
