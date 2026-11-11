import assert from 'node:assert/strict';
import { test } from 'node:test';
import { routeCommand } from '../src/router.ts';

const address = 'DemoAddressX7';
const verified = { address, amount: '0.1', network: 'testnet' };
const balance = { kind: 'route', tool: 'get_balance', address, network: 'testnet' };
const block = { kind: 'route', tool: 'get_block_number', network: 'testnet' };
const transfer = { kind: 'route', tool: 'prepare_transfer', ...verified };
const clarify = reason => ({ kind: 'needs_clarification', reason });

const commands = [
  ['Bu adresin QoreChain bakiyesini göster.', verified, balance],
  ['Bu adreste ne kadar QOR var?', verified, balance],
  ['Seçili adresin bakiyesini sorgula.', verified, balance],
  ['   BAKİYEYİ     GÖSTER.  ', verified, balance],
  ['Adres bakiyesini öğren.', verified, balance],
  ['Bu adresin bakiyesini kontrol et!', verified, balance],
  ['DemoAddressX7 adresinin bakiyesini göster.', verified, balance],
  ['QoreChain son blok numarasını öğren.', verified, block],
  ['En güncel blok numarası kaç?', verified, block],
  ['SON BLOK NUMARASINI GÖSTER!', verified, block],
  ['Son blok yüksekliği nedir?', verified, block],
  ['Test ağında son blok numarasını sorgula.', {}, block],
  ['Ana ağda en son blok numarası kaç?', {}, { ...block, network: 'mainnet' }],
  ['QoreChain blok yüksekliğini göster.', {}, { kind: 'route', tool: 'get_block_number' }],
  ['Bu adrese 0,1 test QOR göndermek için işlem hazırla.', verified, transfer],
  ['Test ağında bu adrese 0,10 QOR transferi için taslak oluştur.', verified, transfer],
  ['Seçili adrese transfer taslağı hazırla.', verified, transfer],
  ['DemoAddressX7 adresine 0.1 QOR transfer taslağı hazırla.', verified, transfer],
  ['BU ADRESE TRANSFER TASLAĞI HAZIRLA.', verified, transfer],
  ['Ana ağda bu adrese 0,1 QOR transferi için taslak oluştur.', { ...verified, network: 'mainnet' }, { ...transfer, network: 'mainnet' }],
  ['Bu adresin bakiyesini göster.', {}, clarify('missing_address')],
  ['Seçili adrese işlem taslağı hazırla.', { amount: '0.1', network: 'testnet' }, clarify('missing_address')],
  ['Bu adrese 0,1 QOR transfer taslağı hazırla.', { address, network: 'testnet' }, clarify('missing_amount')],
  ['Test ağında bu adrese transfer taslağı oluştur.', { address, amount: '0.1' }, clarify('missing_network')],
  ['Bu adrese 0,2 QOR transfer taslağı hazırla.', verified, clarify('conflicting_amount')],
  ['Ana ağda bu adrese transfer taslağı hazırla.', verified, clarify('conflicting_network')],
  ['demoaddressx7 adresinin bakiyesini göster.', verified, clarify('conflicting_address')],
  ['BaşkaAdres42 adresine transfer taslağı hazırla.', verified, clarify('conflicting_address')],
  ['Bakiyeyi göster ve son blok numarasını öğren.', verified, clarify('multiple_intents')],
  ['Son blok numarasını göster, bu adrese transfer taslağı hazırla.', verified, clarify('multiple_intents')],
  ['Transfer yapma, sadece bakiyeyi göster.', verified, balance],
  ['Bakiyeyi sorgulama, yalnızca son blok numarasını göster.', verified, block],
  ['Son blok numarasını öğrenme; seçili adrese transfer taslağı hazırla.', verified, transfer],
  ['Transfer yapma.', verified, clarify('ambiguous_command')],
  ['Transfer yapma; bu adrese transfer taslağı hazırla.', verified, clarify('ambiguous_command')],
  ['Sadece blok hakkında bilgi ver.', verified, clarify('ambiguous_command')],
  ['Bu adrese hemen 1 QOR gönder.', verified, clarify('ambiguous_command')],
  ['Blok numarası kaç ve cüzdanı bağla?', verified, clarify('ambiguous_command')],
  ['Bakiyeyi gösterme.', verified, clarify('ambiguous_command')],
  ['Bakiyeyi göster ama gönderme.', verified, clarify('ambiguous_command')],
  ['Bu adrese -0,1 QOR transfer taslağı hazırla.', verified, clarify('ambiguous_command')],
  ['Bu adrese 1,000.25 QOR transfer taslağı hazırla.', verified, clarify('ambiguous_command')],
  ['Bu adrese 0 QOR transfer taslağı hazırla.', { ...verified, amount: '0' }, clarify('missing_amount')],
  ['Test ağında bakiyeyi göster.', { address, network: 'mainnet' }, clarify('conflicting_network')],
  ['Ana ağda son blok yüksekliğini öğren, test ağında son blok numarasını göster.', {}, clarify('ambiguous_command')],
];

for (const [command, inputs, expected] of commands) {
  test(command, () => assert.deepEqual(routeCommand(command, inputs), expected));
}
