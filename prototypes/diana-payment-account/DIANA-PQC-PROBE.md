# Diana ML-DSA-87 salt okunur provası

**16 Kasım 2026 · Sonuç: PARTIAL**

**Canlı precompile provası PASS.** Diana, yayımlanmış ML-DSA-87 vektörünü kabul etti. Değiştirilmiş mesaj, değiştirilmiş imza ve kısaltılmış imza ayrı ayrı reddedildi. Prototip sözleşmesinin içinden, kayıtlı bir fatura sahibiyle gerçek ELA faturasının doğrulanması henüz kanıtlanmadı.

## RPC sonuçları

`https://evm-testnet.qore.host/` üzerinde `eth_chainId` sonucu **`0x2648` (9800)** oldu. `eth_blockNumber` **`0x9bb4a9` (10.204.329)** döndürdü. Beş `eth_call` aynı blokta yapıldı. Tüm çağrılar HTTP 200 döndürdü. Bu sorgular zincire işlem eklemez, fon harcamaz ve EVM penceresi sayaçlarını tüketmez. [Resmî Diana uç noktaları](https://docs.qorechain.io/getting-started/connecting-to-testnet/) · [Pencere muhasebesi](https://docs.qorechain.io/developer-guide/evm-window-reference/) · [Ham istek ve yanıtlar](diana-pqc-probe-evidence.json)

| RPC kimliği | Adres ve işlev | Canlı sonuç |
|---|---|---|
| 3 | `0x…0A02` · `pqcKeyStatus(address)` · selector `0x850dfe51` | Örnek adres `0x0000000000000000000000000000000000000001` için `[false, 0, 0x, false]`, **160 bayt**. RPC hatası oluşmadı. Kayıtsızlık ABI alanlarıyla bildirildi. |
| 4 | `0x…0A01` · `pqcVerify(pubkey, signature, message)` · selector `0xf52bde0a` | Özgün genel vektör **`true`**, **32 bayt**. |
| 5 | Aynı doğrulayıcı | Mesajın ilk baytında bir bit değişikliği **`false`**, **32 bayt**. |
| 6 | Aynı doğrulayıcı | İmzanın ilk baytında bir bit değişikliği **`false`**, **32 bayt**. |
| 7 | Aynı doğrulayıcı | 4.627 yerine 4.626 baytlık imza **`false`**, **32 bayt**. |

Yalnızca önceden yayımlanmış **qorechain-pqc v0.2.3, `vectors/ml-dsa-87.json`, vaka 0** kullanıldı. Repo içindeki genel kopya, 2.592 baytlık genel anahtarı, özgün mesajı ve 4.627 baytlık imzayı içeriyor. Üç girdinin SHA-256 değerleri kanıt JSON’unda kayıtlı. Bu doğrudan `pqcVerify` çağrısında hesap adresi, key kaydı veya sahiplik kanıtı verilmedi. Dolayısıyla genel vektörü doğrulamak için bir Diana hesabına kayıt işlemi gerekmedi. [Yayımlanan vektör sürümü](https://github.com/qorechain/qorechain-pqc/tree/v0.2.3/vectors) · [ELA’daki genel kopya](../../src/pqc/demo/official-vector.ts) · [Resmî precompile ABI’si](https://docs.qorechain.io/developer-guide/evm-precompiles/)

## Fatura yoluyla uyumluluk

- **Canlı ABI.** `pqcKeyStatus` dört alan döndürüyor: `registered`, `algorithmId`, `pubkey`, `possessionProven`. Kurulu `@qorechain/evm` 0.14.0 paketinin `IQORE_PQC_ABI` tanımı ilk üç çıktıyı listeliyor. İlk çözümleme dördüncü alanı bu nedenle göstermedi. Prova betiği belgelenmiş dört alanı açıkça tanımlar ve canlı yanıtı dört alanla çözümler. Mevcut Solidity arayüzü zaten dört alanı kullanıyor. [Precompile referansı](https://docs.qorechain.io/developer-guide/evm-precompiles/) · [Solidity arayüzü](src/DianaPaymentAccount.sol#L4)
- **Kayıtsızlık ve ret.** Örnek adresin canlı 160 baytlık yanıtı, fatura sözleşmesinin kayıtlı 2.592 baytlık anahtar için beklediği 2.752 bayta ulaşmaz. Sözleşme bu yanıtta `PqcKeyUnavailable` ile ödemeyi durdurur. Canlı doğrulayıcının `true` ve `false` yanıtları da sözleşmenin beklediği 32 baytlık ABI bool biçiminde. Kayıtlı bir fatura sahibinden gelen pozitif anahtar durumu ve sözleşme içindeki iki çağrının birleşik yürütmesi bu provada denenmedi. [Sözleşmenin yanıt denetimi](src/DianaPaymentAccount.sol#L135) · [Ham yanıtlar](diana-pqc-probe-evidence.json)
- **Fatura kapsamı.** `invoiceDigest`, sürümlü tür özetiyle birlikte chain ID, sözleşme, fatura sahibi, alıcı, tutar, fatura kimliği, nonce ve süreyi bağlar. `pay` ayrıca chain ID 9800’ü, yetkili yürütücüyü, sıralı nonce’u ve kullanılmamış fatura kimliğini kontrol eder. Mevcut Foundry kayıtlarında başka sözleşmeye kopyalama, yanlış zincir, değiştirilmiş fatura kimliği ve nonce/fatura tekrarı senaryoları geçti. Bu testlerde precompile yanıtları simüle edilmişti. Canlı genel vektörün mesajı ELA fatura özeti değildir. [Fatura özeti](src/DianaPaymentAccount.sol#L90) · [Ödeme kontrolleri](src/DianaPaymentAccount.sol#L101) · [Yerel test kaydı](.tools/forge-invoice-test.log)

## Kalan önkoşullar

Gerçek ELA faturasında zincir üzerinde kayıtlı, sahipliği kanıtlanmış ML-DSA-87 anahtarı olan prototip fatura sahibi gerekir. Fatura, gerçek sözleşme adresi ve geçerli nonce ile üretilen 32 **ham** özet baytına bağlanmalıdır. Bu provada fatura sahibi, ELA imzası, dağıtılmış sözleşme veya aktif ajan penceresi kullanılmadı. Önceki yerel ödeme ve precompile simülasyon testleri, bu eksikleri kapatmaz.

**Sonraki tek görev:** Kayıtlı ve sahipliği kanıtlanmış bir testnet fatura sahibi ile gerçek sözleşme adresi hazır olduğunda, tek geçerli ELA faturası ve değiştirilmiş karşılığını sözleşmenin `pay` yolu üzerinden `eth_call` ile karşılaştır. Zincire yazan ödeme provası için ayrıca kapsamlı EVM penceresi ve işlem kanıtı gerekir.

## Tekrar çalıştırma

Bu klasörde mevcut Node.js, `viem`, `@qorechain/evm` ve Windows `curl.exe` ile:

```powershell
node diana-pqc-probe.mjs
```

Betiğin izinli RPC yöntemleri `eth_chainId`, `eth_blockNumber` ve `eth_call` ile sınırlı. Her koşu yeni bir blok seçer ve [kanıt JSON’unu](diana-pqc-probe-evidence.json) günceller. Her isteğin parametreleri, HTTP durumu, ham JSON-RPC yanıtı ve çözümlenmiş sonucu kaydedilir. Zincir işlemi, kayıt, imzalama, anahtar erişimi veya dağıtım yapılmaz.
