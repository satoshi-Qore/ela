# ELA 7I-3 — Onaylı Diana ödeme politikası

Başlangıç: güncel `main` **5a1114b** (PR #38 ve #39 birleştirilmiş). Kullanıcının 7I-3 talebi sabit değerleri ve yedi günlük süreyi açıkça onaylıyor. Bunlar artık öneri veya yeniden onay bekleyen değerler değildir.

## Tek güvenilir yapılandırma

[approved-payment-policy.mjs](../prototypes/diana-payment-account/approved-payment-policy.mjs), `APPROVED_PAYMENT_POLICY` altında değişmez public yapılandırmayı tutar. Üst kayıt `approvalStatus: approved`; onay kaynağı 7I-3 kullanıcı talebidir. Network, parametre ve zaman nesneleri dondurulmuştur. Tutarlar `BigInt` ile tam wei değerleridir.

| Alan | Kayıtlı değer | Durum |
|---|---|---|
| Ağ | Diana `qorechain-diana`, EVM 9800 | Onay kapsamı |
| Executor / Invoice Owner | `0x6a5d4D7B3357df968b2A3004071eCe98f015C794` | Korundu / onaylı |
| Alıcı | `0xc9Ab55FeC7c1fEe27F3AFc5DF99E6A09b4B2D875` | Onaylı |
| Ödeme başı tavan | **1000000000000000 wei = 1000 uqor = 0,001 QOR** | Onaylı |
| Toplam bütçe | **3000000000000000 wei = 3000 uqor = 0,003 QOR** | Onaylı |
| Ödeme adedi | **3** | Onaylı |
| Süre | **604800 saniye**; `endsAt = startsAt + 604800` | Onaylı |
| Kesin `startsAt`, `endsAt` | **null / null** | Seçilmedi, onaylanmadı |
| Gerçek işlem yetkisi | **`executionAuthorized: false`** | Verilmedi |

Dağıtım günü oturumun `Europe/Istanbul` zaman diliminde değerlendirilir. Bu bir Unix zamanı seçimi değildir; hiçbir başlangıç veya bitiş değeri `Date.now()` ile doldurulmaz. Kesin tarih onayı, aynı dosyanın `timing.approvalStatus: pending` / `approvalSource: null` alanlarında politika onayından ayrıdır.

## Mevcut araçlara bağlantı

`diana-deploy.mjs` bu dosyayı kullanır; yeni bir dağıtım yolu, CLI komutu veya işlem izni eklenmedi.

- Varsayılan constructor kontrol listesi onaylı rol/alıcı/tutar/adet alanlarını tanır. `chosen`, rol/adres, tutar ve adet kontrolleri geçer. Tam constructor için yalnız `reviewed` (kesin tarihler) ve `dates` eksiktir; metin sabit politikanın zaten onaylı olduğunu açıkça söyler. Alıcı kodu, gerçek PREPARE'de mevcut salt-okunur `eth_getCode` yöntemiyle yeniden kontrol edilir; bu görevde o ağ kontrolü tekrar çalıştırılmadı.
- `deploymentPackage({params: null, ...})` onaylı değerleri `policyApproval` içinde gösterir; `missingApprovals` yalnız **startsAt / endsAt** olur. Sonuç **blocked**, canlı runtime pini ve readiness config **null** kalır. Alıcı veya tutarlar yeniden seçilecek alanlar gibi gösterilmez.
- Default PREPARE, onaylı kısmi değerleri raporlar; eksik tarihleri örnek tarihlerle tamamlamaz, initcode veya gas tahmini üretmez. Paket/constructor/readiness anlamları birbirine karıştırılmaz.
- Kaynak onayı yalnız Diana ve tam eşleşen sabit politika için geçerlidir. Başka ağ veya başka değerlerle gelen genel/test parametreleri bu onayı miras almaz.
- Onaylı politika için mevcut tarih kontrolü ayrıca **604800 saniyeyi** ve **gerçek dağıtım gününü** denetler. Çağıranın yalnız `reviewed: true` vermesi kesin tarihleri 7I-3 kapsamında onaylı yapamaz; public runtime pini de çıkaramaz. Daha sonraki açık tarih onayı aynı güvenilir yapılandırmada kayıt altına alınmalı ve constructor tarihleriyle eşleşmelidir.

## Yürütme kilidinin kanıtı

Gerçek kontrol hâlâ **`export const LIVE_CONSTRUCTOR_PARAMS = null;`** satırıdır. Politika onayı bu değeri üretmez veya değiştirmez. Sabit politikanın onaylı olması, hatta yerel fixture'da geçerli tarih verilmesi dahi varsayılan CLI'yi açmaz. Testlerde varsayılan `dispatchDeployment` için broadcast/verify etkileri **sıfır kez** çağrıldı; kapı `Constructor parameters not chosen` ile durdu. Etkileşimli terminal veya rapor yolu verilmesi de null kapısını aşmadı.

`executionAuthorized: false` onay kaydının kapsamını gösterir; mevcut null/CLI/onay kapılarının yerine geçen yeni bir yetkilendirme sistemi değildir. Tarih alanlarını doldurmak da kendi başına pencere açma, imzalama, fonlama, dağıtım veya yayın yetkisi vermez.

## Yalnız değişen davranışın doğrulaması

- **9 yeni test geçti.** Değişmez değerler, onay kapsamı, tarih-only bekleyen alanlar, süre/gün koşulu, caller `reviewed` bayrağıyla kapsam genişletilememe, ağsız varsayılan PREPARE raporu ve sıfır yürütme etkisi kontrol edildi. Testlerdeki tarih sayıları yalnız yerel fixture girdileridir; kaynak politikaya yazılmadı veya kullanıcı seçimi sayılmadı.
- **2 doğrudan ilgili mevcut kilit regresyonu geçti.** Eski paket/CLI null ve test-only korumaları doğrulandı. Önceki tam hazırlık, kriptografi veya zincir deneyleri tekrar edilmedi.
- Üretim TypeScript/Vite derlemesi geçti. Web bundle adları aynı kaldı. [Yeni test sonucu](evidence/diana-policy-7i3/policy-final.txt), [kilit regresyonu](evidence/diana-policy-7i3/lock-final.txt), [derleme](evidence/diana-policy-7i3/build-final.txt).

Bağımsız incelemenin işaret ettiği tarih onayı atfı ve dağıtım günü koşulu, [başarısız testlerle](evidence/diana-policy-7i3/date-approval-red.txt) gösterilip düzeltildi. 7I-3 onayı artık bir caller bayrağıyla kesin tarih onayına genişletilemez. Önceki kanıt dosyaları korundu. Bu görevde özel anahtar okunmadı/kullanılmadı; imza, pencere, broadcast veya deployment yapılmadı. Sözleşme, manifest, CORE, Model2Vec, ajan güvenlik/RPC izinleri ve kilitli bağımlılıklar değişmedi. PR #37/#32/#33'e dokunulmadı.

## Sonraki adım için zorunlu kalanlar

1. **Gerçek dağıtım günündeki kesin başlangıç Unix zamanı ve bunun açık onayı.** Bitiş, zaten onaylı kural gereği bundan **604800 saniye** sonradır; bağımsız bir süre veya bütçe kararı beklenmiyor. Aynı yapılandırmadaki tarih kaydı ve mevcut constructor/PREPARE araçları kullanılır.
2. **Gerçek işlem için ayrı, açık yetki:** pencere açma, imzalama ve yayınlama/dağıtım. Bu yetkiler henüz verilmedi; null kapısı otomatik açılmayacak.

Yeni alıcı/tutar/adet/süre onayı istenmez. Tarih ve işlem yetkisi sağlansa da mevcut taze ağ/nonce/fee/gas/pencere ve deployment sonrası doğrulamalar normal güvenlik koşulları olarak geçmek zorundadır; yeni kullanıcı politika seçimi değildir. PR taslak kalır, birleştirilmez.
