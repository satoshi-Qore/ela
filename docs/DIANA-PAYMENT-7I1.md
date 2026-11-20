# ELA 7I-1 — Diana Payment Account salt-okunur hazırlık katmanı

20 Kasım 2026. **Altyapı çalışıyor; mevcut canlı önkoşullar BLOCKED.** Bu çalışma bir ödeme yürütücüsü değildir. Hiçbir özel anahtar okunmadı; hesap üretilmedi, işlem veya fatura imzalanmadı, pencere açılmadı, sözleşme dağıtılmadı ve zincire işlem gönderilmedi.

## Başlangıç ve korunmuş işler

Uzak `main` başlangıçta `23f6f216932420385274e4f211163cbf749c564b` idi. [PR #37](https://github.com/satoshi-Qore/ela/pull/37), `798ff319d5d0bfee75fac597da1dd8be959378d8` üzerinde açık taslaktı; iki uzak CI çalışması başarılıydı. PR #37'nin içeriği, dalı ve durumu değiştirilmedi. Yeni çalışma `work/ela-diana-readiness-7i1` dalında, ayrı `ela-diana-readiness-7i1` worktree'sinde main'den başladı; birleştirilmemiş Model2Vec dalı taşınmadı.

Mevcut prototipin sözleşmesi, hibrit hazırlama/imzalama/yayınlama araçları, anahtar kaydı, PQC probu ve önceki test raporları incelendi. Sözleşme zaten chain ID 9800'e bağlı imzalı faturayı, sabit yürütücü/alıcı/fatura sahibini, nonce ve harcama sınırlarını uyguluyor. Önceki 29 Forge ve iki çevrimdışı kriptografi testi README'de kayıtlı; değişmeyen sözleşme yeniden derlenmedi veya dağıtılmadı. PQC kayıt işlemi `480E146F…347C6` ve ilk hibrit öz-gönderim `367930C3…AF5E3` önceki tamamlanmış işlerdir; tekrar gönderilmedi. Eski tarihli `DIANA-READINESS.md` sonraki sözleşme/kayıt geliştirmelerinden önce yazılmıştır; bu yeni rapor o dosyayı yeniden yazmaz.

Kaynaklar: [mevcut sözleşme](../prototypes/diana-payment-account/src/DianaPaymentAccount.sol), [prototip ve yerel testler](../prototypes/diana-payment-account/README.md), [tamamlanmış PQC kaydı](../prototypes/diana-payment-account/DIANA-PQC-REGISTRATION.md), [ilk hibrit işlem](../prototypes/diana-payment-account/DIANA-HYBRID-TX.md), [önceki dağıtım önkoşulları](../prototypes/diana-payment-account/DIANA-DEPLOY.md). Eski PQC probu mevcut kanıt dosyasını üzerine yazdığı için çalıştırılmadı.

## Somut işlev ve mimari

- `src/agent/diana-payment-readiness.ts`: `inspectDianaPaymentAccount(publicConfig, options)` ayrı, tipli hazırlık API'sidir. Yapılandırmayı ağ çağrısından önce doğrular ve kopyalar. Sonuç her zaman `executionAuthorized: false`, kapsam `read_only_prerequisites`; durum `ready_for_review` veya `blocked` olur. Eksikler `blocked`, yürütülemeyen bağımlı kontroller `not_checked` olarak açıkça listelenir.
- `src/qorechain/diana-payment-reader.ts`: mevcut sabit Diana uç noktasını, adres doğrulamasını ve süre aşımı/HTTP okuma yardımcılarını kullanır. Dışarıya genel RPC veya serbest calldata arabirimi açmaz. Yalnız `eth_chainId`, `eth_getBlockByNumber`, `eth_getCode`, `eth_getBalance` ve kapalı biçimli `eth_call` okur. `eth_call` yalnız prototipin on salt-okunur getter'ı, `paidInvoices(bytes32)` ve sabit `0x…0a02` üzerindeki `pqcKeyStatus(address)` içindir. `pay`, creation, simulation, imzalama veya broadcast çağrısı yoktur.
- `scripts/check-diana-payment-readiness.mjs`: `npm run payment:readiness` operatör komutudur. Yalnız `--config` ve `--out` alır; `--sign`, `--deploy`, `--broadcast`, özel anahtar veya uç nokta bayraklarını reddeder. Rapor dosyasını özel oluşturma ile yazar, mevcut dosyayı üzerine yazmaz. Çıkış 0 yalnız inceleme önkoşulları sağlandığında, 2 engellenmiş raporda, 1 komut/dosya hatasında kullanılır.

Bu API normal komut yorumlayıcısına, modele veya web arayüzüne bağlanmadı. Mevcut registry'nin ERC-20 `eth_call` izni belirli seçicilerle sınırlıdır; ödeme hazırlığını oraya eklemek mevcut yetki alanını genişletirdi. Ayrı, dar okuma arabirimi bu izinleri değiştirmeden gelecekte yetkili hazırlık akışının çağırabileceği bir sınır oluşturur. İmzalayan/yayınlayan prototip modüllerini içe aktarmaz. Güvenlik kapısı, deterministik yönlendirme, mevcut RPC guard/registry, eşikler, session ve Sapphire CORE kaynakları değişmedi. Yeni bağımlılık veya model optimizasyonu yok.

### Denetlenen koşullar

1. **Ağ ve blok.** Sabit EVM uç noktası önce ve sonda 9800 bildirmeli. Blok başlığı kanonik miktar/32 bayt hash biçiminde olmalı; başlangıçta ve bitişte en fazla 120 saniye eski veya 60 saniye ileride olabilir. Her kod, bakiye ve `eth_call` isteği `{blockHash, requireCanonical: true}` kullanır. Sonda aynı yükseklikte hash/zaman yeniden denetlenir. Hash bağlama desteklenmezse daha zayıf sayı etiketine geri dönülmez; sonuç engellenir. [EIP-1898](https://eips.ethereum.org/EIPS/eip-1898) · [resmî Diana uç noktaları](https://docs.qorechain.io/getting-started/connecting-to-testnet/)
2. **Sözleşme kimliği.** Aday adreste runtime kodu bulunmalı ve operatörün önceden gözden geçirilmiş runtime SHA-256 değeriyle tam eşleşmeli. Pin yoksa veya farklıysa sözleşme getter'ları güvenilir kabul edilmez ve okunmaz. Bu pin, immutable alanlar yerleştirilmiş tam dağıtım runtime'ından hazırlanmalıdır; bilinmeyen adresteki kodun hash'ini otomatik kopyalayarak güven tesis edilmez. API pinin kaynak/derleyici kökenini kendisi kanıtlamaz.
3. **PQC ve sahiplik.** Beklenen yürütücü ve fatura sahibi için kayıt, algoritma 1, 2.592 bayt genel anahtar, zincirin `possessionProven` alanı ve beklenen genel anahtar SHA-256'sı gerekir. Aynı adres iki rolü taşıyorsa bir okuma kullanılır. Dört alanlı dinamik ABI; offset, boolean, uint8, uzunluk ve padding bakımından katı çözülür. Mevcut SDK'nın eski üç alanlı çıktı tanımına dayanılmaz. Bu bir zincir durum okumasıdır; yeni PoP veya fatura imzası üretilmez. [PQC precompile referansı](https://docs.qorechain.io/developer-guide/evm-precompiles/)
4. **Politika.** Kod kimliği doğrulanınca yürütücü, fatura sahibi, alıcı, işlem başı/toplam tutar, adet ve zaman aralığı onaylı genel yapılandırmayla birebir karşılaştırılır. `totalSpent` ve `nextNonce` sınırlar içinde olmalı. Tutarlar wei cinsinden kanonik ondalık metin ve `BigInt` ile işlenir; JavaScript kayan noktasına çevrilmez.
5. **Ödeme önerisi.** Alıcı, pozitif tutar, işlem başı tavan, kalan bütçe, sıradaki nonce, adet tavanı, sözleşme bakiyesi, `[startsAt, endsAt)` aralığı, sıfır olmayan kullanılmamış fatura kimliği ve gelecekteki fatura son tarihi doğrulanır. Fatura son tarihi sözleşme bitişini aşabilir: prototip yalnız her iki sürenin de açık olmasını arar; hazırlık katmanı ilave süre kısıtı icat etmez.
6. **Kapalı hata davranışı.** Eksik yapılandırma, bozuk JSON-RPC zarfı, boş/kesik ABI, yanlış ağ, stale/reorg blok, başarısız HTTP veya timeout hazır sonucu üretemez. Gözlenen genel alanlar ve kontrol edilen öneri raporda saklanır. Hata iletisinde ham uzak RPC içeriği veya yapılandırma sırları yankılanmaz.

Ağ adı raporda hedef Diana eşlemesidir; bu katman ayrıca Native consensus `/status` kimliği okumaz. EVM chain ID denetimi bir hafif istemci kanıtı değildir. Kanonik hash isteğinin doğru uygulanması ve veri doğruluğu resmî RPC'ye güvene dayanır. Rapor blok anına aittir; gelecekteki işlem öncesi tekrar doğrulama gerekir.

## Gerçek Diana verileriyle doğrulananlar

Son uygulama EIP-1898 biçimiyle **20 Kasım 2026 17:23:25–17:23:27 Türkiye saati** okudu. Özel anahtar veya yazma yetkisi gerekmeyen iki genel yapılandırma kullanıldı. Gerçek yanıtlar ile fixture testleri ayrı dosyalardadır.

| Canlı kontrol | Gerçek sonuç |
|---|---|
| EVM kimliği | Başta ve sonda `0x2648` = **9800**. |
| Aday sözleşme | Önceki dağıtım raporunun öngördüğü `0x8a278Cf5B0D34cF844cF19C74116e9DdfB7Aba9d`, blok **10437616**: `eth_getCode` → `0x`, **dağıtılmamış**. Bu bir aday adrestir; yeni dağıtım veya gerçek sözleşme olduğu iddia edilmez. |
| Mevcut Invoice Owner | `0x6a5d4D7B3357df968b2A3004071eCe98f015C794`: kayıtlı, algoritma 1, **2.592 bayt**, sahiplik kanıtı true. Parmak izi **`a3b2c32d6e5d35138c69c2154d36ba0ba1779658cd4f9bc1567b5e35831bab5a`**, önceki kayıtla aynı. Önceki prototip planındaki gibi yürütücü ve fatura sahibi aynı genel adrestir. |
| Eksik PQC tanı senaryosu | Genel `0x0000000000000000000000000000000000010000`, blok **10437617**: kayıt false, algoritma 0, boş anahtar, sahiplik false. Bu ELA hesabı veya önerilen canlı rol değildir. |
| Blok bağı ve tutarlılık | Kod/anahtar okumaları seçilen hash'e bağlı, `requireCanonical: true`; bitişte blok hash'i aynı. Diana bu istek biçimini kod ve PQC `eth_call` için kabul etti. |
| Son karar | Her iki rapor **blocked**, CLI çıkışı **2**. |

Kanıtlar: [aday sözleşme/gerçek rol raporu](evidence/diana-payment-7i1/live-candidate-verified.json), [ham aday RPC çağrıları](evidence/diana-payment-7i1/live-candidate-verified-rpc.json), [eksik PQC raporu](evidence/diana-payment-7i1/live-missing-pqc-verified.json), [ham eksik PQC çağrıları](evidence/diana-payment-7i1/live-missing-pqc-verified-rpc.json). İlk sayı-etiketli gözlemler de silinmeden tutuldu; son `*-verified` dosyaları hash-bağlı sürümdür.

**Zincirde henüz doğrulanmayanlar:** Dağıtılmış ödeme hesabının runtime/politika/sayaç/bakiye okumaları, `paidInvoices` durumu, gerçek ödeme önerisinin pozitif sonucu, fatura imzası ve sözleşmeden PQC doğrulamasının birleşik akışı. Olumlu sözleşme/politika/ödeme önkoşulu yolu yalnız yerel fixture ile geçti. Hash-bağlı `eth_getBalance` biçimi gerçek sözleşme olmadığı için bu canlı koşularda çağrılmadı; olası destek hatası hazır sonucu yerine engellenmiş sonuç verir. Yeni genel imza vektörü, imza üretimi veya önceki hibrit işlem deneyi tekrarlanmadı.

## Eksik önkoşullar

- İncelenmiş gerçek alıcı, işlem başı/toplam tutar, adet ve süre değerleri; önceki test parametreleri canlı politika olarak seçilmedi.
- Mevcut kullanıcı yetki sürecinden geçmiş gerçek sözleşme dağıtımı ve doğrulanmış adres. Bu görev dağıtım yapmaz.
- Kaynağı ve immutable alanları incelenmiş tam runtime SHA-256 pini.
- Açıkça seçilmiş genel ödeme önerisi: alıcı, tutar, fatura kimliği, nonce, son tarih.
- Daha sonraki **ayrı yetkili yürütme sistemi** için kanonik fatura imzası, hedefle sınırlı hibrit EVM penceresi, fee/gas bütçesi ve kullanıcı onayları. Bunlar bu API'nin olumlu durumuyla doğrulanmış veya yetkilendirilmiş sayılmaz. Aktif pencere açma, imzalama ve ödeme yürütme bu aşamaya eklenmedi.

## Kullanım

Mevcut genel bilgilerle eksikleri gözlemlemek için, depo kökünde:

```powershell
npm run payment:readiness -- --config docs/evidence/diana-payment-7i1/public-candidate-config.json --out diana-readiness-observation.json
```

Bu dosya onaylanmış canlı politika değildir ve bilinçli olarak engellenmiş rapor verir. Yeni çıktı adı kullanın. `--help` salt-okunur sınırı ve seçenekleri gösterir. CLI özel anahtar, signer, serbest RPC, bytecode yükleme veya işlem yürütme seçeneği sunmaz.

Tam inceleme için gereken genel alanlar:

| Alan | İçerik |
|---|---|
| `contractAddress`, `executor`, `invoiceIssuer` | Sıfır olmayan, precompile aralığı dışında geçerli EVM adresleri; mixed-case ise EIP-55 doğru olmalı. |
| `expectedRuntimeSha256` | Gözden geçirilmiş tam runtime kodunun 64 küçük hex karakterlik SHA-256'sı. |
| `pqcKeySha256.executor`, `.invoiceIssuer` | Güvenilen rol anahtarlarının 64 küçük hex karakterlik parmak izleri. |
| `policy` | `recipient`, `maxPerPaymentWei`, `spendingLimitWei`, `maxPayments`, `startsAt`, `endsAt`. Sayılar ondalık metin; zamanlar Unix saniyesi. |
| `payment` | `recipient`, `amountWei`, `nonce`, `invoiceId` (32 bayt hex), `validUntil`. İmza veya özel anahtar değil. |

Tipli çağrı `inspectDianaPaymentAccount(config, {fetch?, timeoutMs?})` şeklindedir. `fetch` ve test saati `nowSeconds` yalnız güvenilen uygulama/test bağımlılıklarıdır; model çıktısından veya operatör JSON'undan alınmaz. Bilinmeyen üst veya iç yapılandırma alanları reddedilir. `ready_for_review` çıktısı işlem oluşturma malzemesi veya imza izni içermez; kalıcı yetki belgesi olarak kullanılmamalıdır.

## Doğrulama ve inceleme

Yeni 19 otomatik test gerçek ağ çıktısı üretmez; sıkı ABI'yi, eksik sözleşme/anahtarı, ağ/HTTP/RPC hatalarını, yanlış pin/politikayı, tavan/bütçe/adet/nonce/bakiye/süre/fatura tekrarını, büyük tam sayıları, yapılandırma kopyasını, CLI bayraklarını, blok değişimini, okuma sonunda bayatlamayı ve EIP-1898 destek hatasını sınar. [İlk RED](evidence/diana-payment-7i1/readiness-red.txt), [süre tazeliği RED](evidence/diana-payment-7i1/snapshot-freshness-red.txt), [inceleme RED](evidence/diana-payment-7i1/review-red.txt), [hash bağı RED](evidence/diana-payment-7i1/hash-binding-red.txt), [19 test GREEN](evidence/diana-payment-7i1/readiness-reviewed-green.txt).

Bağımsız salt-okunur incelemede kritik bulgu yoktu. Blok-sayısı ile okumanın karışık fork riski ve sözleşmede olmayan ek fatura süresi reddi düzeltildi. Raporun hangi öneriye ait olduğunun kaybolması da genel yapılandırmanın rapora alınmasıyla giderildi. Düzeltmeler için önce başarısız, sonra başarılı testler kaydedildi. Pin kökeni, fatura imzası, pencere/fee ve gerçek yürütme incelemenin bu aşamada doğrulamadığı bağımlılıklar olarak açıkça korundu.

Son tam paket, gerçek Chrome zorunlu olacak şekilde **1.344 test: 1.343 başarılı, 0 başarısız, 1 isteğe bağlı canlı test atlandı** sonucu verdi. Yeni 19 test bu toplamın içindedir. TypeScript + Vite üretim derlemesi geçti; yeni katman web girişine bağlanmadığı için üretim main/PQC chunk adları değişmedi. [Tam test günlüğü](evidence/diana-payment-7i1/full-test-verified.txt) ve [üretim derlemesi](evidence/diana-payment-7i1/build-verified.txt) sonuçları saklanıyor. Uzak CI, yerel test sonucundan çıkarılmaz; yeni taslak PR'de ayrıca kontrol edilir. Eski test/deney raporları silinmedi; bu görevin ilk koşuları da korunuyor.
