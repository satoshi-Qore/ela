# ELA 7I-2 — Diana gerçek dağıtım hazırlığı

20 Kasım 2026. Başlangıç: PR #38'in birleştirildiği `main` **c162dbf**. Ayrı dal: `work/ela-diana-deploy-prep-7i2`. **Teknik araç eksikleri tamamlandı; gerçek dağıtım hâlâ BLOCKED.** `LIVE_CONSTRUCTOR_PARAMS = null` değişmedi.

Bu görevde özel anahtar okunmadı/üretilmedi/kullanılmadı; imza, pencere açılışı, simülasyon, deployment veya broadcast yapılmadı. Önceki PQC kaydı, hibrit işlem ve kriptografi deneyleri tekrarlanmadı. PR #37/#32/#33 değiştirilmedi. Solidity sözleşmesi, Foundry hedef ayarı, CORE, Model2Vec, ajan güvenlik kapısı ve RPC izinleri değişmedi.

## Dört sorunun yanıtı

1. **Gerçek dağıtımı engelleyen teknik sorun kaldı mı?** Bilinen artifact/CLI eksikleri kapatıldı. Ancak gerçek constructor değerleri olmadan kesin initcode, runtime pini ve gerçek deployment gas'ı üretilemez. Açık pencere de yok. Gerçek argümanlarla gas tahmini, creation dry-run ve sonraki zincir doğrulaması henüz yapılmadı; canlı dağıtıma hazır sonucu verilmez. Yeni paralel deployment sistemi gerekmiyor.
2. **Kullanıcı hangi değerleri onaylamalı?** Gerçek alıcı; ödeme başı tavan; toplam bütçe; ödeme adedi; `startsAt` ve `endsAt`. Executor ve Invoice Owner, daha önce doğrulanan **0x6a5d4D7B3357df968b2A3004071eCe98f015C794** olarak korunur. İncelenen güncel kaynak, prototip raporları ve 7I-1 kayıtlarında diğer altı alan için onaylı değer bulunmadı. Koruma tavanları veya eski test değerleri kullanıcı kararı yerine geçmez.
3. **Öncesinde ve sonrasında hangi kontroller var?** Aşağıdaki kontrol sırası uygulanır; onaylı değerler için pin/CREATE/gas yeniden üretilir. Sonrasında hash'e bağlı makbuz/kod, immutable politika, sayaçlar ve 7I-1 anahtar/politika okumaları doğrulanır.
4. **Onay verildiğinde mevcut araçlarla yapılabilecek mi?** **Koşullu evet.** Onaylanan sekizli, gözden geçirilmiş bir değişiklikle canlı sabite yazıldıktan ve ayrı pencere/işlem yetkisi verildikten sonra mevcut pencere ve deployment araçları yeterlidir. Yeni CLI yolları aynı `runDeployBroadcast` ve `verifyDeployment` işlevlerini kullanır. Parametre onayı tek başına imza/broadcast yetkisi değildir. Canlı gas, dry-run veya pencere kontrolü başarısız olursa araç durur; bu rapor zincir kabulünü garanti etmez.

## Tek karar tablosu

| Konu / constructor alanı | Kanıt veya mevcut durum | Gereken karar / kalan koşul | Gerçek dağıtıma etkisi |
|---|---|---|---|
| `executor` | Önceki doğrulanmış Invoice Owner adresi korunuyor. | Yeni adres seçilmedi; aynı rol kalacak. | Kod eksiği yok. |
| `invoiceIssuer` | Aynı doğrulanmış adres; mevcut PQC parmak izi `a3b2c32d…bab5a`. | Yeni kayıt veya yeni anahtar yok; işlem öncesi mevcut durum yeniden okunur. | Kod eksiği yok. |
| `recipient` | Onaylı gerçek alıcı bulunmadı. | EIP-55 geçerli EOA; sıfır/precompile/placeholder/owner/sözleşme adresi olmayacak. Zincirde kodu olmamalı. | **Kullanıcı kararı gerekli.** |
| `maxPerPayment` | Onaylı tutar yok. | Pozitif, tam uqor karşılığı wei; toplam bütçeyi aşmayacak. | **Kullanıcı kararı gerekli.** |
| `spendingLimit` | Onaylı bütçe yok. | Ödeme tavanından küçük olmayacak; mevcut 1 QOR koruma tavanı aşılmayacak. 1 QOR seçilmiş değer değildir. | **Kullanıcı kararı gerekli.** |
| `maxPayments` | Onaylı adet yok. | Mevcut 1–100 koruması içinde açık adet. | **Kullanıcı kararı gerekli.** |
| `startsAt` | Onaylı başlangıç yok. | Unix saniyesi; en fazla 30 gün ileride. | **Kullanıcı kararı gerekli.** |
| `endsAt` | Onaylı bitiş yok. | Başlangıçtan sonra, dağıtım hazırlığında en az bir gün ileride; aralık en fazla bir yıl. | **Kullanıcı kararı gerekli.** |
| Compiler / kaynak / artifact | SHA-256'sı önceki kayıtla eşleşen Solidity **0.8.28**; **Paris**. Kaynak değişmedi. Temiz derleme creation/runtime/immutable haritasıyla eşleşti. | Sabit manifest ve kaynak hash'leri yeniden doğrulanır. Fark olursa durur. | **Teknik eksik kapatıldı.** |
| Initcode / immutable runtime / SHA-256 | Mevcut sekiz argüman sırası korunur. Immutable slot sayıları 2/4/3/2/2/2/2/2; toplam 19 adet 32 bayt slot. Aralıklar sıfır dolgulu, çakışmasız ve sınır içinde. | Onaylı değerler olmadan canlı initcode/runtime pini yok; yalnız template hash'i var. | **Değerleri bekliyor.** |
| CREATE / nonce | Canlı sequence = EVM latest = pending = **2**. Bugünkü nonce 2 adresi `0x2026C0190D739C646418BaeEe4e242d456b44502`. | Pencere nonce'u ilerletir. Sonrasında nonce tekrar okunur. Nonce 3 için `0x8a278Cf5…Aba9d` yalnız koşullu tahmin. | Eski adres kesin adres sayılmaz. |
| Fee / gas / bakiye | Canlı gasPrice **112,5 gwei**, baseFee **100 gwei**, bakiye **99,8575 QOR**. Mevcut fee cap **150 gwei**, tip **12,5 gwei**, gas tavanı **1.710.000** korunuyor. | Gerçek argümanlarla gas tahmini gerekir. Tavan maliyet 256.500 uqor = 0,2565 QOR; bu gerçek gas ölçümü değildir. | Fiyat tavanı bugün yeterli; **gerçek gas bilinmiyor.** |
| Deployment penceresi | Canlı `found: false`, `live: false`. Mevcut plan 400 blok, tek işlem, hedef listesi boş, nativeOnly false; bütçe tavanları korunuyor. | Ayrı yetkiyle mevcut pencere aracı kullanılmalı. Gerçek gas maliyetini karşılamalı; 1 tx, kullanılmamış, en az 30 blok kalmış olmalı. | **Yetkili sonraki işlem gerekli.** |
| PREPARE / BROADCAST / VERIFY CLI | Önceden null sonrasında da kalan `Unknown option` stub'ı giderildi. Null, reviewed/testOnly ve Windows TTY korumaları yerinde. | İmza öncesi public PREPARE raporu yeni dosyaya `wx` ile yazılır. İki onay mevcut akışta kalır. | **Teknik eksik kapatıldı; yürütme kilitli.** |
| Zincir kabulü / son doğrulama | Yerel public fixture'lar geçti; gerçek creation veya ödeme sonucu yok. | Gerçek argümanlarla dry-run; sonra işlem/makbuz/kod/politika ve pencere kullanımını doğrulama. | **Canlıda henüz kanıtlanmadı.** |

## Tamamlanan teknik değişiklikler

Mevcut `diana-deploy.mjs` genişletildi; yeni bir dağıtım mekanizması eklenmedi.

- Artifact yükleyici compiler/Paris/constructor ABI'sini, sabit kaynak hash'ini ve temiz derlemeden alınan **creation bytecode + runtime template + tam immutable haritası** tuple'ını doğrular. Değişmiş opcode, aynı sayıda slotu olan iki alanın haritasının yer değiştirmesi, eksik/taşan/çakışan/dolu slotlar reddedilir. Metadata tek başına kaynak kökeni kanıtı sayılmaz.
- [Manifest](../prototypes/diana-payment-account/deployment-artifact-manifest.json) ve [derlenmiş public fixture](evidence/diana-deploy-7i2/compiled-contract.json) saklandı. Manifest değişikliği kaynak ve derleyici incelemesi gerektirir; otomatik yeniden güven oluşturulmaz. Compiler SHA-256: `76a71001309810aafd0462d9b2f2612bf19b89550c866140edca26e533de06bc`.
- `deploymentPackage()` exact constructor ABI'sinden initcode hash'lerini, immutable değerler yazılmış runtime SHA-256'sını ve 7I-1'in `expectedRuntimeSha256`/rol/politika alanlarını üretir. `executionAuthorized` her zaman false; ödeme önerisi veya imza icat etmez. Paket, on-chain recipient-code veya taze PREPARE yerine geçmez. Eksik/onaysız/test-only parametrelerde canlı pin ve 7I-1 config **null** kalır.
- Default PREPARE, `LIVE_CONSTRUCTOR_PARAMS` null iken eski örnek parametreleri kullanmaz; gerçek hesap/fee/nonce/pencere bilgilerini okur fakat `eth_estimateGas` göndermez. Initcode, kesin maliyet ve runtime pin alanları null; sonuç readyToSign false, CLI çıkışı 2.
- Gelecekte yetkili broadcast yolu mevcut iki onayı, kayıt anahtarının zincirle eşleşmesini, yeniden PREPARE/fingerprint denetimini, imza biçimi denetimini ve creation dry-run'ı korur. Yalnız kullanıcının etkileşimli Windows terminalinde çalışabilir. Bu görevde bu yol **çalıştırılmadı**.
- İmza öncesi saklanan public PREPARE raporu tek JSON nesnesidir; imzalı bayt içermez ve üzerine yazılmaz. VERIFY bu dosyadan, güncel sabit artifact ve onaylı parametrelerle beklentiyi yeniden kurar. İşlem hash'i/chain/type/nonce/input/gas/fee cap/tip/access list; makbuz hash'i, blok bağı, durum, gas kullanımı, CREATE adresi ve receipt-block'taki kanonik runtime karşılaştırılır. Ardından nonce artışı ve pencere kullanımı aranır. Bir sonraki hesap işlemi öncesi doğrulanmalı; beklenmeyen nonce değişikliği durdurur.
- CLI giriş yolu native path çözümü kullanır; Linux CI'de de null kilidi gerçekten çalışır. İmzalama için Windows TTY şartı gevşetilmedi. Belirsiz yayın hatasında “hiçbir şey gönderilmedi” denmez; public faz raporuna ve tekrar göndermeme kuralına yönlendirir.

Şu komut **yalnız salt-okunur** mevcut eksikleri raporlar; prototip klasöründe ve incelenmiş artifact `out/` altında olmalıdır:

```powershell
node diana-deploy.mjs
```

Gelecekte ayrı onay ve parametre değişikliği sonrası mevcut `--broadcast --prepare-report <yeni-dosya.json>` biçimi public beklentiyi ilk imzadan önce kaydeder; `--verify <TXHASH> --prepare-report <aynı-dosya.json>` yalnız okuma yapar. Şu an iki yol da null korumasında durur. Çıktı birden fazla faz JSON'u içerdiği için stdout'un tamamı VERIFY girdisi yapılmaz; özel public PREPARE dosyası kullanılır. Mevcut dosya yeniden kullanılmaz, belirsiz broadcast otomatik tekrarlanmaz.

## Gerçek zincir verisi ve fixture ayrımı

[Canlı PREPARE](evidence/diana-deploy-7i2/live-prepare.json) ve [ham 18 çağrı](evidence/diana-deploy-7i2/live-rpc.json), **20 Kasım 2026 18:44:19–18:44:23 Türkiye saati**, Native yükseklik **10441011** civarında alındı. Yalnız GET, `eth_chainId`, `eth_getTransactionCount`, `eth_getBalance`, `eth_gasPrice`, `eth_getCode` kullanıldı. Kimlikler Diana/9800, hesap 16046, mevcut PQC anahtar hash'i önceki kayıtla eşleşiyor. Pencere yok. Gas, tam bakiye yeterliliği ve constructor kontrolleri eksik değerler nedeniyle engelleniyor; bu alanlar gerçek bir başarısız deployment deneyi değildir.

Ağ okumaları mevcut prototip gibi ardışık Native/EVM gözlemleridir; tek bloklu veya imza zamanı geçerli kalacak bir yetki belgesi değildir. Gelecekteki akış yeniden PREPARE ve katı fingerprint karşılaştırması yapar. 7I-1'in kanonik hash'e bağlı ayrı okuma katmanı değiştirilmedi.

Yerel fixture'da onaylıymış gibi işaretlenen değerler yalnız **test girdileridir**; kullanıcının seçimleri veya gerçek dağıtım değerleri değildir. Pozitif PREPARE, runtime SHA-256/policy eşleşmesi, gas sınırları ve pozitif makbuz senaryosu bu public fixture'larla doğrulandı. Gerçek constructor gas'ı, creation dry-run, pencere açılışı/kullanımı, dağıtılmış kod ve 7I-1 pozitif sözleşme sonucu henüz zincirde doğrulanmadı.

## Dağıtım öncesi ve sonrası kontrol sırası

Öncesinde: kullanıcı altı değeri seçer/onaylar; sekizli kaynakta incelenir ve null sabit ancak açık onayla değiştirilir. Canonical compiler/manifest/immutable haritası tekrar denetlenir. Mevcut pencere PREPARE'i ve gerçek constructor gas tahminiyle bütçe değerlendirilir; tavan aşılırsa durulur. Ayrı yetkiyle pencere açılır ve makbuzu doğrulanır. Sonrasında EVM latest/pending/Native sequence yeniden eşitlenir, CREATE adresi ve kesin paket üretilir. Pencere ve recipient-code dahil bütün PREPARE kontrolleri geçmelidir. Mevcut akışın iki onayı, yeniden PREPARE, imza biçimi ve creation dry-run zorunludur.

Sonrasında: tx hash ve type 2/chain 9800/from/nonce/gas/fee/input/access-list; receipt status 1/aynı tx/blok/gas; nonce'dan hesaplanan contractAddress; kanonik receipt-block runtime bytes ve SHA-256; nonce +1 ve pencere kullanımı doğrulanır. 7I-1'e paket içindeki public config verilerek immutable roller/limitler, PQC sahiplik/parmak izi, policy ve sayaçlar okunur. Ödeme önerisi ancak ayrıca seçilirse eklenir. Sözleşme başlangıç bakiyesinin sıfır olması mümkündür; hazır ödeme fonu var sayılmaz. Kalan pencere kapatma veya fonlama da ayrı yetkili işlemdir.

## Doğrulama ve kalan sınırlar

Yeni **10 public-data testi** ve ilgili 7I-1/EVM/gas regresyonları: **133/133 geçti**, atlama yok. [Son regresyon](evidence/diana-deploy-7i2/regression-verified.txt). Üretim TypeScript/Vite [derlemesi geçti](evidence/diana-deploy-7i2/build.txt); web chunk'ları değişmedi. Eski özel test mnemonic'iyle imza üreten prototip test dosyası çalıştırılmadı; ilgili fixture beklentileri yeni ABI/receipt şartlarına uyarlandı, yeni public-data regresyonları aynı değişen yolları kapsıyor. Önceki Forge/kripto deneyleri tekrar edilmedi.

[Temiz derleme](evidence/diana-deploy-7i2/compile-fresh.txt), yeni out/cache klasöründe gerçekten yeniden derledi; retained ilk fixture ile creation/runtime/map tuple'ı birebir aynı. [Artifact audit](evidence/diana-deploy-7i2/artifact-audit.json) compiler hash'ini, kaynak hash'lerini ve 7188-byte creation / 6039-byte runtime template'i kaydeder. İlk denemede derleme başarılı, kök dizine bağlı lint yolu hatalıydı; sonraki doğru-root lint kontrolü cache hit verdi. Bu iki kayıt temiz yeniden derleme gibi sunulmaz. Compiler-only fresh build ve önceki doğru-root lint kaydı ayrı saklanır. Hiçbir eski çıktı silinmedi.

Bağımsız inceleme artifact provenance ve eksik VERIFY bağı buldu; canonical tuple pini ve public negatif testlerle düzeltildi. Public PREPARE dosyası ve kullanılabilir VERIFY argv'si tamamlandı. İnceleme gerçek imza/yayın/dağıtım başarısını kanıtlamaz. Kaynak/pin değişikliği insan incelemesi, kullanıcı parametre onayı ve gerçek zincir kontrolleri hâlâ gereklidir. Uzak CI, yerel 133 testten ayrı raporlanır. PR taslak kalır; birleştirilmez.

[Solidity 0.8.28 compiler çıktıları](https://docs.soliditylang.org/en/v0.8.28/using-the-compiler.html) · [Diana pencere/nonce referansı](https://docs.qorechain.io/developer-guide/evm-window-reference/)
