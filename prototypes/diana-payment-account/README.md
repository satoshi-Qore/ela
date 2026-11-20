# Diana sınırlı ödeme hesabı

Bu Solidity prototipi, sabit bir alıcıya yerel ağ varlığı ödeyen bir sözleşme hesabıdır. Kurulumda yürütücü, güvenilen fatura sahibi, alıcı, işlem başı ve toplam tutar tavanları, ödeme adedi ve `[startsAt, endsAt)` zaman aralığı belirlenir. Tutarlar EVM’nin en küçük birimiyle, zamanlar Unix saniyesiyle verilir. Yürütücü işlemi gönderir. Fatura sahibi ödemeyi ayrı olarak yetkilendirir. Kurallar dağıtımdan sonra değiştirilemez.

`pay(target, amount, nonce, invoiceId, validUntil, signature)` gönderende `msg.sender` ve ağda Diana chain ID **9800** şartı arar. İlk nonce sıfırdır. `nextNonce` hem sıradaki nonce’u hem de başarılı ödeme adedini tutar. Sıfır fatura kimliği geçersizdir ve aynı kimlik yeni bir nonce ile de harcanamaz. `validUntil` kapsama dahil olmayan son andır. Doğrulama geçince sözleşme, yeniden giriş kilidi açıkken fatura ve harcama durumunu günceller, ardından sabit alıcıya ödeme yapar. Alıcı çağrısı başarısızsa fatura, sayaçlar ve nonce geri alınır.

## Fatura imzası

İmza girdisi `invoiceDigest(target, amount, invoiceId, nonce, validUntil)` fonksiyonunun döndürdüğü **32 ham bayt**. Özet, `keccak256(abi.encode(typeHash, chainId, account, issuer, recipient, amount, invoiceId, nonce, validUntil))` şeklindedir. `typeHash`, kaynakta tanımlı `DianaInvoiceV1(...)` tür metninin Keccak-256 özetidir. Hex metni, JSON veya mesaj imzalama öneki kullanılmaz.

Sözleşme sabit `0x…0A02` adresine `pqcKeyStatus(address)` ve sabit `0x…0A01` adresine `pqcVerify(bytes pubkey, bytes signature, bytes message)` çağrısı yapar. Fatura sahibinin kayıtlı, sahipliği kanıtlanmış 2.592 baytlık ML-DSA-87 anahtarı ve 4.627 baytlık imza gerekir. Boş, kesik, çözümlenemeyen veya başarısız yanıt ödemeyi durdurur. Eski imzasız `pay` fonksiyonu kaldırıldı. [QoreChain precompile ABI’si](https://docs.qorechain.io/developer-guide/evm-precompiles/)

## Yerel doğrulama

**Sonuç: PARTIAL.** Yerel derleme ve testler geçti. Diana’da imzalı fatura doğrulaması ve ödeme henüz kanıtlanmadı.

| Kanıt | Sonuç | Kapsam |
|---|---|---|
| Derleme ve Forge | **29 geçti, 0 başarısız, 0 atlandı.** Önceki 15 senaryo yeni imzalı çağrıya uyarlanarak korundu. | Yerel EVM, Diana precompile’larını uygulamıyor. Test double’lar belirli çağrı baytlarına yanıt vererek politika, ABI ve durum değişikliklerini sınar. Sıfır dolgulu imza test girdisi kriptografik vektör değildir. [Forge günlüğü](.tools/forge-invoice-test.log) |
| Gerçek çevrimdışı kriptografi | **2 geçti, 0 başarısız.** Kurulu `@qorechain/pqc` 0.2.3 ve Node.js OpenSSL aynı yayımlanmış ML-DSA-87 vektörünü kabul etti, değiştirilmiş mesaj ve imzayı reddetti. | Genel anahtar, mesaj ve imza mevcut resmî vektörden okundu. Vektörün mesajı ELA fatura özeti değildir. Bu test anahtar oluşturmaz veya imza üretmez. [Kriptografi günlüğü](.tools/public-ml-dsa-vector-test.log) |

Araçlar Foundry Forge, Solidity **0.8.28** ve Forge’un işlem içi yerel EVM’idir. Hedef EVM sürümü **Paris** olarak sabitlendi. Solidity paketi, `forge-std`, yerel düğüm ve cüzdan bağımlılığı yok. Testler Forge’un yerel `prank`, `deal`, `warp` ve `expectRevert` yardımcılarıyla çalışır. Deneme adresleri sabit değerlerdir.

| Araç veya arşiv | Sürüm | SHA-256 |
|---|---|---|
| `.tools/foundry-v1.8.0.zip` | Foundry 1.8.0, Windows x64 | `e31241db9bc6ebdccaf1bcee9ee57e5896120166cfc5711570d280beb051982e` |
| `.tools/forge.exe` | Forge 1.8.0, commit `61ae26af36320d4fa1020f7db53785885e29eeb5` | `40857534501f4d16bae9adee458a9293f00f9c70d615df485bd0297795a4bbd9` |
| `.tools/solc.exe` | Solidity `0.8.28+commit.7893614a.Windows.msvc` | `76a71001309810aafd0462d9b2f2612bf19b89550c866140edca26e533de06bc` |

Foundry arşivi ve Solidity çalıştırılabilir dosyası resmî SHA-256 değerleriyle eşleşti. Forge dosyasının hash’i doğrulanmış arşivden çıkarıldıktan sonra kaydedildi. Araçlar prototipin `.tools` klasöründe tutulur. [Foundry yayın dosyaları](https://github.com/foundry-rs/foundry/releases/expanded_assets/v1.8.0) · [Solidity Windows manifesti](https://raw.githubusercontent.com/ethereum/solc-bin/gh-pages/windows-amd64/list.json)

Derleyici ve Forge mevcutsa bu klasörde şu komut kullanılabilir. `--offline` otomatik derleyici indirmesini engeller.

```powershell
forge test --offline -vv
```

Bu klasöre indirilen araçlarla tekrar çalıştırmak için:

```powershell
& ./.tools/forge.exe test --offline --use (Resolve-Path .tools/solc.exe).Path -vv
node --test test/public-ml-dsa-vector.test.mjs
```

Paket, ödeme ve limitlerin yanında süre sınırlarını, eski ve ileri nonce’u, yetersiz bakiyeyi, alıcının ödemeyi reddetmesi durumunda geri almayı ve yetkili bir alıcının yeniden giriş denemesini kapsar.

## Diana’ya geçmeden önce

- Canlı koşuda fatura sahibinin PQ kaydı ve sahiplik kanıtı, prototipten iki precompile çağrısının gerçek sonucu, gaz ve kanonik 32 baytlık fatura imzası doğrulanmalı. Hatalı imza ve geçerli imzaya rağmen limit aşımı ayrı senaryolar olarak kanıtlanmalı. [QoreChain precompile referansı](https://docs.qorechain.io/developer-guide/evm-precompiles/)
- Çalıştırmadan önce Diana EVM 9800, bytecode uyumu, güncel ücretler, PQ anahtar kaydı, hibrit imzalı pencere açılışı ve tek `allowedTargets` adresi doğrulanmalı. Pencere dışı ret, sözleşme kuralı reddi ve başarılı ödeme ayrı makbuz ve durum kanıtlarıyla gösterilmeli. [QoreChain pencere referansı](https://docs.qorechain.io/developer-guide/evm-window-reference/)
- Prototipte fon kurtarma, anahtar değiştirme veya acil durdurma işlevi yok. Deneme ödemesi kadar test fonu ayrılmalı. Süre bitiminde veya yürütücü kaybında kalan fonlar sözleşmede kalır.
- Bu prototip mevcut ELA arayüzüne veya Model2Vec’e bağlanmaz. Yarışma için sözleşme temelli akıllı hesap yorumunun kabulü ve canlı kanıtlar gerekir.

## 7I-2 deployment preparation

The existing deployment tool now pins the reproducible Solidity 0.8.28/Paris artifact and can produce the 7I-1 runtime SHA-256/config after reviewed constructor values exist. Live values remain null; no signing or deployment occurred. See the [single decision table, live read-only evidence and checklists](../../docs/DIANA-DEPLOY-7I2.md).
