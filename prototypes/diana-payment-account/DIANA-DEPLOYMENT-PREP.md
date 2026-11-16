# Diana imzalı fatura hazırlığı — 7A

**Karar: BLOCKED.** Yerel hazırlık ve testler tamamlandı. 7B için ayrı testnet hesapları, fatura sahibinin doğrulanmış PQC kaydı, dağıtılmış sözleşme adresi, testnet bütçesi ve işlem bazında kullanıcı onayları gerekiyor.

## Hazır dosyalar, araçlar ve mevcut Diana kanıtı

| Dosya veya araç | Doğrulanan kullanım |
|---|---|
| [DianaPaymentAccount.sol](src/DianaPaymentAccount.sol) | Sabit alıcı ve harcama politikası, yetkili yürütücü, fatura özeti, iki PQC precompile çağrısı |
| [DianaPaymentAccount.t.sol](test/DianaPaymentAccount.t.sol) | Yerel politika ve ABI testleri. PQC yanıtları testte taklit edilir. |
| [public-ml-dsa-vector.test.mjs](test/public-ml-dsa-vector.test.mjs) | Yayımlanmış genel vektörün QoreChain PQC ve OpenSSL ile gerçek FIPS 204 doğrulaması |
| [DIANA-PQC-PROBE.md](DIANA-PQC-PROBE.md), [prova betiği](diana-pqc-probe.mjs), [ham RPC kanıtı](diana-pqc-probe-evidence.json) | Diana üzerinde önceden kaydedilen salt-okunur precompile sorguları |
| [DIANA-READINESS.md](DIANA-READINESS.md), [README](README.md) | Ağ, prototip ve dağıtım önkoşulları |
| Mevcut yerel araçlar | Forge 1.8.0, solc 0.8.28, Node.js v24.18.0, QoreChain SDK 0.14.0 ve viem. Yeni kurulum yapılmadı. |

Kayıtlı RPC kanıtında Diana EVM RPC `https://evm-testnet.qore.host/` zincir kimliğini `0x2648` (9800) olarak verdi. Native zincir kimliği `qorechain-diana`. Önceki provadaki beş `eth_call` blok `0x9bb4a9` üzerinde HTTP 200 döndürdü. `0x…0A02` kayıtsız `0x…0001` için `[false, 0, 0x, false]` döndürdü. `0x…0A01` yayımlanmış ML-DSA-87 vektörünü kabul etti ve değiştirilmiş mesajı, değiştirilmiş imzayı ve kısaltılmış imzayı reddetti. 7A bu kaydı inceledi. Kayıt, fatura sahibi için pozitif anahtar durumu ve dağıtılmış sözleşmeden `pay` çağrısı içermiyor. [Ham kanıt](diana-pqc-probe-evidence.json) · [Resmî ağ bilgileri](https://docs.qorechain.io/getting-started/connecting-to-testnet/) · [Genel vektör](https://github.com/qorechain/qorechain-pqc/tree/v0.2.3/vectors)

## PQC kaydı, sahiplik kanıtı ve ABI

**Kimlik tasarımı.** Yalnızca Diana için üç ayrı hesap kullan: fatura sahibi, dağıtıcı ve yürütücü. Her hesabın Native ve EVM adres eşleşmesini onaylanmış SDK türetim yöntemiyle doğrula. Sözleşmenin `invoiceIssuer` alanına fatura sahibinin `0x` adresi girilir. PoP içinde aynı sahibin Native hesap adresi kullanılır. Fatura imzası yerelde kullanıcı denetimindeki imzalayıcıda üretilir. Yürütücü yalnızca sözleşmeyi çağırır. Sözleşmede ödeme fonu, yürütücüde gaz için gereken testnet QOR bulunur. Alıcı önceden onaylanmış sabit bir testnet adresidir. Fatura sahibinin hesabına kayıt ücreti için gereken kadar fon ayır. Anahtar ve kurtarma bilgisini süreç çıktısı, komut satırı, rapor, yapay zekâ modeli veya uzak servise aktarma. 7A’da hesap ve anahtar ayrımı tasarlandı, anahtar üretilmedi. [QoreChain anahtar bağlama rehberi](https://docs.qorechain.io/build-before-qday/key-binding/)

**Resmî kayıt.** İlk kayıt Native `MsgRegisterPQCKeyV2` ile, hesapta kullanılabilir PQC anahtarı yokken klasik secp256k1 imzasıyla başlatılabilir. `keyType=hybrid`, ML-DSA-87 algoritma kimliği `1` ve hesabın kendi klasik genel anahtarı kullanılır. Yeni PQC anahtarı UTF-8 olarak `qorechain-pqc-pop-v1|qorechain-diana|1|<Native adres>|<küçük harfli genel anahtar hex>` baytlarını imzalar. İmza `proof_of_possession` alanına girer. İlk kayıtta PoP zincir protokolünde isteğe bağlıdır, ELA için zorunludur. Sonraki Native anahtar işlemleri ve EVM penceresi açma/kapatma hibrit yetki kullanır. İlk kayıt için var olan kaydı sessizce atlayabilecek otomasyonun sonucu ayrıca kontrol edilmeli. [QoreChain Post-Quantum Signing](https://docs.qorechain.io/developer-guide/post-quantum-signing/) · [EVM pencere referansı](https://docs.qorechain.io/developer-guide/evm-window-reference/)

Kurulu `@qorechain/sdk` 0.14.0 bildirimlerinde `proofOfPossessionSignBytes` ve `signProofOfPossession` (satır 3699–3705), `fetchPqcStatus` (16084), `buildRegisterPqcKeyMsg` (16230) ve `ensurePqcRegistered` (16252) doğrulandı. Denetlenebilir işlem için önce mesajı açıkça oluşturup alanlarını incele, ardından onaylanmış imzalama ve yayın adımına geç. `ensurePqcRegistered` kayıt başlatabildiği için salt-okunur kontrol olarak kullanılmamalı. Kayıt sonrası Native REST `GET /qorechain/pqc/v1/account/{address}` ile `0x…0A02` sonuçlarını karşılaştır. Hesap eşleşmesini, algoritmayı, genel anahtarın birebir eşitliğini ve sahiplik bayrağını doğrula. [Kurulu SDK bildirimleri](../../node_modules/@qorechain/sdk/dist/index.d.ts#L16230) · [Resmî kayıt açıklaması](https://docs.qorechain.io/developer-guide/post-quantum-signing/#proof-of-possession-optional)

| Çağrı | Dönüş ve güvenlik kararı |
|---|---|
| `0x…0A02` `pqcKeyStatus(address)`, seçici `0x850dfe51` | Dört çıkış sırasıyla `registered: bool`, `algorithmId: uint8`, `pubkey: bytes`, `possessionProven: bool`. Resmî belge dördüncü alanı hesabın güncel anahtarının doğrulanmış sahiplik kanıtı olarak tanımlıyor. Mevcut Diana negatif kanıtı bu alanı `false` gösteriyor. 7B’de gerçek fatura sahibi için `true, 1, 2592 bayt, true` gözlenmeden devam edilmemeli. |
| `0x…0A01` `pqcVerify(bytes,bytes,bytes)`, seçici `0xf52bde0a` | Girdiler genel anahtar, imza ve mesaj. Dönüş `bool`. Geçerli genel vektör doğrudan doğrulanabilir. Sözleşme ayrıca anahtar kaydını ve sahipliğini zorunlu tutar. |
| Yerel ABI uyumluluğu | Kurulu `@qorechain/evm` 0.14.0 içindeki `IQORE_PQC_ABI` üç çıkış tanımlar. Güvenlik kararında sözleşmedeki ve provadaki dört çıkışlı arayüz kullanılmalı. Çağrı hatası, beklenmeyen dönüş veya geçersiz imzada ödeme reddedilir. |

[Resmî ABI](https://docs.qorechain.io/developer-guide/evm-precompiles/) · [Sözleşme doğrulaması](src/DianaPaymentAccount.sol#L135) · [Prova betiği](diana-pqc-probe.mjs)

## Constructor ve tekrarlanabilir yerel doğrulama

Constructor sırası `executor_`, `recipient_`, `maxPerPayment_`, `spendingLimit_`, `maxPayments_`, `startsAt_`, `endsAt_`, `invoiceIssuer_`. Tutarlar EVM temel birimi, zamanlar Unix saniyesidir. Ödeme başlangıcı dahil, bitişi ve fatura son kullanma zamanı hariçtir. Adresler, bütçe ve zaman aralığı dağıtımdan önce kesinleşmeli. `pay`, üst sınırları, yeterli bakiyeyi, yetkili yürütücüyü, sıradaki fatura nonce’unu ve benzersiz fatura kimliğini denetler. Başarısız alıcı çağrısı sayaç, nonce ve fatura kaydını geri alır. [Constructor](src/DianaPaymentAccount.sol#L61) · [Ödeme ve durum güncellemesi](src/DianaPaymentAccount.sol#L101)

1. Tam tür dizgesinin UTF-8 Keccak-256 özetini al: `DianaInvoiceV1(uint256 chainId,address account,address issuer,address recipient,uint256 amount,bytes32 invoiceId,uint256 nonce,uint256 validUntil)`.
2. `keccak256(abi.encode(typeHash, chainId, account, issuer, recipient, amount, invoiceId, nonce, validUntil))` hesapla. ABI türleri sırasıyla `bytes32,uint256,address,address,address,uint256,bytes32,uint256,uint256`. `pay` ABI'sinde `nonce` parametresi `invoiceId` alanından önce gelir. Fatura imzasının mesajı 32 ham özet baytıdır. EIP-191 öneki, hex metni veya ikinci hash ekleme.
3. İmzasız yerel referans değerleri: zincir 9800, hesap `0x` + 20 kez `11`, fatura sahibi 20 kez `22`, alıcı 20 kez `33`, tutar 1, fatura kimliği 32 kez `44`, nonce 0 ve son geçerlilik 1800000000. viem ile hesaplanan değer `0x319f43d9c3bd284dd03c8af18dacd362aca50d831e6e27c31c871bd0b7011ec9`. Sekiz fatura alanının her birini tek başına değiştirince özet değişti.
4. Yerel Forge testi ayrı ABI kodlamasıyla özetin eşleşmesini ve hatalı alanların reddini kontrol eder. Mevcut imzalı genel vektör ile yerel kriptografi testini çalıştır. 7B’de özel onaydan sonra gerçek hesap ve nonce ile aynı özeti zincirdeki `invoiceDigest` sonucuna karşılaştır. Gerçek imza çıktısı için doğrulayıcının kabulünü ve değişmiş mesajı reddetmesini kontrol et. Hesap üretimi ve fatura imzalama bu aşamanın dışındadır.

[Solidity özet fonksiyonu](src/DianaPaymentAccount.sol#L90) · [Yerel ABI karşılaştırması](test/DianaPaymentAccount.t.sol#L184) · [Genel vektör testi](test/public-ml-dsa-vector.test.mjs)

### 7A test sonucu

Prototip klasöründen çalıştırılan komutlar:

```powershell
.\.tools\forge.exe test --root . --offline --use (Resolve-Path .\.tools\solc.exe).Path -vv
node --test test/public-ml-dsa-vector.test.mjs
```

- **Solidity PASS, 29/29.** Mevcut derleme çıktısı kullanıldı. Foundry imza adı önbelleği için uyarı verdi. Politika kontrolleri ve precompile çağrı protokolü yerel testlerle doğrulandı. [Forge kaydı](.tools/forge-deployment-prep.log)
- **Kriptografi PASS, 2/2.** QoreChain PQC ve OpenSSL yayımlanmış geçerli imzayı kabul etti, değiştirilmiş girdileri reddetti. [Kriptografi kaydı](.tools/crypto-deployment-prep.log)
- **Özet alanı bağlama PASS, 8/8.** Yerel viem hesabında sekiz alan ayrı ayrı değiştirildi. Özet testi imzalama gerektirmedi.

## Eksik adresler, yetkiler ve bütçe

| Gereken | 7B’de kesinleşecek bilgi |
|---|---|
| Fatura sahibi | İzole Native ve EVM adresi, ML-DSA-87 genel anahtarı, PoP’lu kayıt işlem hash’i, Native kabul sonucu ve pozitif EVM durumu. Native kayıt gazı. |
| Dağıtıcı | İzole Native ve EVM adresi, hybrid yetki, Native aç/kapat ücreti ve tek sözleşme oluşturma işleminin azami gazı. |
| Yürütücü | İzole Native ve EVM adresi, hybrid pencere yetkisi, sadece gereken EVM gaz bakiyesi, `allowedTargets=[sözleşme]`. |
| Alıcı ve sözleşme | Onaylı tek alıcı adresi, derleme çıktısının hash’i, tam constructor değerleri, dağıtım sonrası gerçek sözleşme adresi ve doğrulanmış çalışma kodu, onaylı testnet ödeme bakiyesi ve fatura tutarı. |
| Kesin ücretler | Native kayıt ve pencere işlemleri için ağ gaz politikası, EVM işlemleri için ağ gas tahmini ve ücret tavanı. Pencere `maxValue` toplam EVM işlem değeri ve azami ücretleri uqor üzerinden kapsamalı. Yerel Forge gazı gerçek Diana bütçesi olarak kullanılmamalı. |

Diana penceresinin blok süresi ve işlem kabul sayaçları, sözleşmenin saniye, ödeme sayısı ve tutar limitlerinden bağımsızdır. `pay` için dış işlem değeri sıfırdır. Ödeme sözleşmenin kendi bakiyesinden çıkar ve sözleşme bütçesini azaltır. Pencere, çağıranın EVM işlemini ve azami ücretini sınırlar. Native işlemden sonra EVM nonce’u yeniden sorgulanır. Faturanın `nextNonce` değeri doğrudan sözleşmeden ayrı okunur. [EVM pencere muhasebesi ve nonce](https://docs.qorechain.io/developer-guide/evm-window-reference/)

## 7B için uygulama sırası ve ayrı onaylar

1. Diana kimliklerini, sabit alıcıyı, ücret ve ödeme tavanını belirle. **Ayrı onay** ile yalnız Diana için izole kimlikleri hazırla. Testnet fonu istemek veya aktarmak için ilgili adres, tutar ve yöntemle ayrı onay al.
2. Fatura sahibi, dağıtıcı ve yürütücü için PQ anahtar sahiplik kanıtı ve Native kayıt mesajlarını incele. **Ayrı onay** sonrasında PoP üret ve kayıtları imzala/yayınla. Her Native makbuzunu ve public key eşleşmesini doğrula. Fatura sahibinin dört alanlı durumunda `possessionProven=true` zorunlu.
3. Derleme çıktısı hash’ini, constructor parametrelerini ve gas tavanını sabitle. **Ayrı onaylarla** dağıtıcı için kısa, bir işlemlik, hedef listesi boş ve `nativeOnly=false` pencere aç, finalite sonrası nonce oku ve sözleşmeyi dağıt. Makbuz, adres ve çalışma kodunu doğrula. Açık dağıtım penceresini ayrı yetkilendirilmiş kapatma işlemiyle kapat.
4. Sözleşmeye yalnızca onaylı testnet ödeme tutarını yükle. **Ayrı onay** öncesinde adresi ve transfer tutarını göster. EVM yolu kullanılıyorsa fonlayan hesap için hedefi sözleşmeyle sınırlayan pencere ve ücretleri ayrıca hesaba kat. Sözleşme bakiyesini ve immutable ayarları zincirden oku.
5. Gerçek sözleşme adresi, alıcı, `nextNonce`, benzersiz kimlik ve geçerlilik süresiyle tek fatura oluştur. Zincirdeki ve yerel özetleri karşılaştır. **Ayrı fatura imzalama onayı** sonrasında izole fatura sahibiyle imzala. Yerelde kayıtlı genel anahtarla doğrula. Aynı blokta, `from=executor` ile `eth_call` üzerinden geçerli çağrıyı ve tek baytı değişmiş imzayı dene. Başarı dönüşü, hata verisi, blok, adresler ve değişmeyen sözleşme sayaçlarını kaydet. Bu sorgu gönderen anahtarına sahipliği veya pencere kabulünü kanıtlamaz.
6. Gerçek ödeme provası ayrıca onaylanırsa yürütücü için yalnız sözleşmeyi kapsayan kısa pencereyi aç. Native finalite sonrası pencereyi ve EVM nonce’unu tekrar oku. **Ayrı yayın onayı** ile pozitif ödeme, pencere reddi ve sözleşme politikası reddini bağımsız senaryolar halinde yürüt. Pozitif işlemde EVM makbuzu, `PaymentExecuted` ve pencere kullanım olayı alınır. Pencere kabulünden önce redde RPC hata kodu/metni ve pencere durumu saklanır, böyle bir reddin makbuzu olmayabilir. Sözleşme reddinde dahil edilen işlemin başarısız makbuzunu ve değişmeyen sözleşme sayaçlarını kaydet. Dahil edilen revert pencere kotası ve ücret tüketebilir. Ayrı onayla açık pencereyi kapat.

Ödeme veya pencere denemesi öncesi beklenen tüm doğrulamalar tamamlanmalı. 7A’da özel anahtar okunmadı veya üretilmedi, fatura imzalanmadı, kayıt, transfer, dağıtım ve zincire işlem yapılmadı.
