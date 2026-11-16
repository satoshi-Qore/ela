# Diana testnet hazırlık raporu

**16 Kasım 2026 · Karar: BLOCKED**

Diana’nın EVM ve Native RPC’leri ile REST yapılandırması yanıt verdi. EVM pencere sorgusu çalışıyor ve ML-DSA-87 precompile’ları etkin listede. Mevcut prototipin [15 yerel testi](README.md) geçmiş durumda. Bu sürüm `msg.sender` ile yürütücüyü tanır ve harcama politikasını uygular. İmzalı faturayı zincir kimliğine bağlayan doğrulama henüz yok. ELA’ya ait pencere açılışı, dağıtım veya ödeme makbuzu da üretilmedi. Bu nedenle imzalı fatura içeren testnet demosuna geçiş **BLOCKED**. [Mevcut ödeme fonksiyonu](src/DianaPaymentAccount.sol#L61)

## Doğrulanmış ağ bilgileri

Salt okunur sorgular 16 Kasım’da yapıldı. Native son blok zamanı yanıtında **16.10.35 UTC** görüldü.

| Kontrol | Resmî beklenti ve canlı gözlem |
|---|---|
| EVM JSON-RPC | `https://evm-testnet.qore.host/` yanıt verdi. `eth_chainId` → `0x2648` (**9800**); `eth_blockNumber` → `0x9bb26f` (**10203759**). |
| Native consensus RPC | `https://rpc-testnet.qore.host/status` → ağ `qorechain-diana`, yükseklik **10203759**, `catching_up: false`. Gözlemler ayrı sorgularda alındı. |
| Native REST ve pencere | `https://api-testnet.qore.host/qorechain/pqc/v1/evm_limits` → etkin alanlar `tx_max_gas: 30000000`, `precompile_input_max_bytes: 16384`. Genel örnek adresin `/qorechain/pqc/v1/evm_window/{address}` sorgusu HTTP 200 ve `found: false, live: false` döndürdü. Adres bir ELA hesabı değildir. |
| EVM yapılandırması | `/cosmos/evm/vm/v1/params` → `evm_denom: uqor`, uzatılmış birim `aqor`, sözleşme oluşturma ve çağırma `ACCESS_TYPE_PERMISSIONLESS`. `0x…0A01` ve `0x…0A02` etkin statik precompile listesinde. |
| Akıllı hesap modülü | `/qorechain/abstractaccount/v1/config` → `enabled: true`, `max_session_keys: 10`, `max_spending_rules: 5`, `default_session_ttl: 86400`. Bu modül, prototipin sözleşme harcama kurallarından ayrı. |

Uç noktalar ve kimlikler resmî Diana bilgileriyle eşleşiyor. Belgeler ağ sürümünü **v3.2.8** olarak veriyor. Canlı `web3_clientVersion` yalnız `Version dev`, Native durum ise CometBFT sürümünü `0.38.26` olarak bildirdi. Uygulama sürümü bu iki yanıttan bağımsız teyit edilemedi. Pencere sorgusu ve limit uç noktası erişimi canlı doğrulandı. Bir pencerenin açılması ve gerçek işlemin kabul veya reddi bu okuma denetiminde ölçülmedi. [Resmî Diana uç noktaları](https://docs.qorechain.io/getting-started/connecting-to-testnet/) · [Pencere referansı](https://docs.qorechain.io/developer-guide/evm-window-reference/)

## Gereken hesaplar ve yetkiler

- **Dağıtıcı.** Test QOR’u ve kayıtlı PQ genel anahtarı olan ayrı bir Diana EVM uyumlu hesap. Native `MsgOpenEVMWindow` klasik secp256k1 ve ML-DSA-87 ile hibrit imzalanır. Sözleşme oluşturma için hedefle sınırlandırılmamış, kısa ve küçük bütçeli bir dağıtım penceresi gerekir. Kurulu Forge/Solidity ile Paris bytecode’u üretilebilir. Daha sonra yetkili bir çalışmada normal EVM sözleşme oluşturma işlemi gönderilir, makbuz `contractAddress` ve zincirdeki bytecode doğrulanır. Dağıtım penceresi kapatılır. Canlı yapılandırma yolun açık olduğunu gösteriyor. Bu prototipin bytecode’unun zincir kabulü henüz doğrulanmadı. [Resmî dağıtım akışı](https://docs.qorechain.io/build-before-qday/workshop-1/) · [Pencere ve sözleşme oluşturma](https://docs.qorechain.io/developer-guide/evm-window-reference/#contract-creation)
- **Ajan yürütücüsü.** Sözleşmenin sabit `executor` adresi olan ayrı EVM uyumlu hesap. Aynı hesabın Native `qor1…` ve EVM `0x…` temsilleri doğrulanır. Hesabın PQ anahtar kaydı ve pencere yönetimi yetkili operatörde kalır. Operatör `allowedTargets` listesine yalnız ödeme sözleşmesini koyar. `maxTxs`, blok ömrü ve EOA’nın değer + azami gas bütçesi sınırlandırılır. Pencere açılışı Native sequence’i ilerletir. Açılış kesinleştikten sonra EVM nonce yeniden okunur. Ham ödeme işlemi EVM secp256k1 imzasını taşır. PQ koruması, işlemi kabul eden hibrit yetkili pencereden gelir. Sözleşmenin `nextNonce` sayacı ayrı bir uygulama sayacıdır. [Native/EVM yetkilendirme ve nonce](https://docs.qorechain.io/developer-guide/evm-window-reference/)
- **Fatura sahibi ve alıcı.** Fatura sahibi, sahipliği kanıtlanmış kayıtlı ML-DSA-87 anahtarı olan sabit bir Diana kimliği. Alıcı, sözleşmenin değişmez testnet yararlanıcısı. Ödeme fonu sözleşme bakiyesinde, gas bütçesi ajan hesabında tutulur. Pencerenin `maxValue` değeri sözleşme bakiyesinden yapılan ödemenin üst sınırı olarak kullanılmaz. Fatura sahibinin anahtarı, pencereyi yöneten anahtarlar ve yürütücü imzalayıcısı modelden ve günlüklerden ayrı kalır. [PQC anahtar bağı](https://docs.qorechain.io/build-before-qday/key-binding/) · [Pencere bütçesinin kapsamı](https://docs.qorechain.io/developer-guide/evm-window-reference/#what-the-window-does-not-govern)

Yerleşik `MsgExecuteEVM` yoluyla authenticator harcaması pencere bütçesine yazılmaz. Bu prototip için değerlendirilen yol, kapsamlı pencereden geçen ham EVM çağrısı ve ardından sözleşmenin kendi harcama denetimidir. Sözleşme hesabı yorumunun kategori kabulü ayrıca belirsizdir. [İstisnalar](https://docs.qorechain.io/developer-guide/evm-window-reference/#what-the-window-does-not-govern) · [Kategori kartı](https://build.qorechain.io/tr/prizes#pq_ai_agents)

## İmza doğrulaması ve eksik entegrasyon

`eth_call` ile `0x…0A02` üzerindeki `pqcKeyStatus(address)` genel örnek adres `0x0000000000000000000000000000000000000001` için ABI biçiminde yanıt verdi. Sonuç kayıt yok, algoritma 0, boş genel anahtar ve sahiplik kanıtı yok şeklinde çözümleniyor. Bu, **anahtar durumu precompile’ının** yanıt verdiğini gösterir. `0x…0A01` üzerindeki `pqcVerify(bytes,bytes,bytes)` etkin listede ve resmî ABI’de mevcut. Bu görevde geçerli bir imza vektörüyle zincir doğrulaması veya prototip sözleşmesinden iç çağrı denenmedi. Çevrimdışı ELA doğrulaması zincir üstü yetkilendirmeyi kanıtlamaz. [Precompile adresleri ve ABI](https://docs.qorechain.io/developer-guide/evm-precompiles/)

İmzalı fatura yolunda sözleşme aşağıdaki adımları uygulamalı:

1. Mevcut yürütücü, sabit alıcı, limit, süre ve sıralı nonce kontrollerini koru. Fatura sahibinin adresi önceden belirlenmiş olmalı.
2. Sürümü, `block.chainid`, sözleşme adresini, sabit fatura sahibini, alıcıyı, tutarı, nonce’u ve fatura son kullanma zamanını uzunluğu belirli, kanonik bir ABI şemasına bağla. İmzalanan baytları ve doğrulayıcıya verilen baytları aynı tanımla üret. Fatura süresi sözleşme penceresinden bağımsız olarak denetlensin.
3. `pqcKeyStatus` ile kayıtlı, sahipliği kanıtlanmış ML-DSA-87 anahtarını al. `pqcVerify(pubkey, signature, message)` sırasıyla doğrula. Eksik kayıt, yanlış algoritma, yanlış uzunluk, başarısız çağrı, boş veya bozuk ABI dönüşü ve `false` sonucu ödeme öncesi ret olmalı. Modelin verdiği genel anahtara veya doğrulama sonucuna güvenilmemeli.
4. Geçerli fatura nonce’u ve harcama durumu, dış çağrıdan önce güncellensin. Alıcı çağrısı başarısızsa tüm sözleşme durumu geri alınsın. Ödemede fatura özeti mevcut `PaymentExecuted` kanıtına bağlanmalı. Ham fatura imzası ve özel anahtar günlük kaydı olmamalı.

Mevcut sürümde fon kurtarma, anahtar rotasyonu ve acil durdurma işlevi bulunmuyor. İlk prova yalnız ayrılmış test hesabı ve kaybı kabul edilebilir küçük test QOR tutarıyla tasarlanmalı. İzinli hedef çağrı argümanlarını tek başına sınırlandırmaz. Nihai alıcı ve harcama sınırı sözleşmede kalmalı. Prototipin başlıca açık teknik riski, geçerli pencere içinden gelen imzasız bir fatura çağrısının bugünkü `pay` fonksiyonunda ayrıca doğrulanmamasıdır. [Prototip kapsamı](README.md) · [Mevcut zincir üstü sınırlar](src/DianaPaymentAccount.sol#L61)

## Üç testnet senaryosu için kanıt

Tüm koşular için ağ kimliği, dağıtıcı ve ajan hesaplarının açık adresleri, ödeme sözleşmesi, fatura sahibi ve sabit alıcı kaydedilir. Başlangıç kanıtına sözleşme dağıtım hash’i/makbuzu, PQ kayıt kanıtı, ajan pencere açılışının Native hash’i/makbuzu, izinli hedef ve sayaçların önceki durumu eklenir. Olumsuz koşular taze pencere ve uygun fatura nonce’u ile ayrıştırılır.

| Senaryo | Koşul | Gerekli kanıt |
|---|---|---|
| **1. Yetkili ödeme başarılı** | Açık kapsamlı pencere, doğru yürütücü ve sözleşme, limit içinde geçerli imzalı fatura. | Ödeme EVM tx hash’i, gönderen/ hedef ve başarılı makbuz, `PaymentExecuted` log’u, fatura özeti, `nextNonce` ve `totalSpent` farkı, alıcı ve sözleşme bakiye farkı. Pencere kullanım olayı `pqc_evm_window_used` ilgili zincir izinden eşleştirilir. EVM makbuzunda görünmüyorsa ilgili blok olayı ve pencere sayaçlarının önce/sonra REST okumaları kullanılır. |
| **2. EVM pencere sınırı nedeniyle ret** | Doğru hedef ve geçerli fatura korunur. Ajan penceresi kapatıldıktan veya blok süresi dolduktan sonra ham çağrı denenir. | Ajan ve hedef adresi, varsa kapatma işleminin Native hash’i ve makbuzu veya pencere bitiş/blok yüksekliği, pencere durum okuması ve RPC kabul hatası. Ödeme olayı, nonce ve bakiye değişimi olmamalı. İşlem zincire alınmadıysa dahil edilmiş hash veya makbuz üretildiği iddia edilmez. |
| **3. Sözleşme harcama politikası nedeniyle ret** | Yeni açık pencere ve doğru sözleşme hedefi korunur. Yetkili fatura sahibi, harcama tavanını aşan ayrı deneme girdisini geçerli biçimde imzalar. Böylece ret nedeni imza veya pencere yerine sözleşme politikası olarak ölçülür. | Dahil edilmiş deneme için EVM tx hash’i, başarısız makbuz ve `InvalidAmount` veya `BudgetExceeded` hatasının doğrulanabilir çözümü. Standart makbuz ret verisini içermeyebilir. Desteklenirse işlem izi, aksi hâlde aynı koşuldaki zincir üzerinden yeniden yürütme kaydı kullanılır. `totalSpent`, fatura nonce’u ve ödeme bakiyeleri değişmemeli. Gas/pencere bütçesinde oluşabilecek tüketim ayrı kaydedilir. |

Pencere reddi ve sözleşme reddi farklı güvenlik katmanlarıdır. İmzalı fatura entegrasyonunda ayrıca tek baytı değişmiş imza veya mesaj ile geçerli limit altında ret ve yeniden oynatmada ret gösterilmelidir. ELA’ya ait imzalı deneme, işlem hash’i veya makbuz bu raporda yoktur. [Pencere olayları ve hataları](https://docs.qorechain.io/developer-guide/evm-window-reference/) · [Resmî testnet makbuz örneği](https://docs.qorechain.io/build-before-qday/workshop-1/)

## Sonraki tek geliştirme görevi

**Prototipe zincir kimliğine bağlı ML-DSA-87 fatura doğrulamasını ekle ve yerel EVM’de test et.** Kabul ölçütü, geçerli fatura için mevcut yedi harcama kontrolünün korunması ve yanlış imza, değiştirilmiş tutar/alıcı, yanlış alan, süresi dolmuş veya tekrar oynatılmış fatura ile boş precompile yanıtının ödeme oluşturmadan reddedilmesidir. Yerel ABI testleri Diana precompile’ında gerçek imza kanıtı olarak sunulmaz.

Bu denetimde sadece bu rapor oluşturuldu. Sözleşme ve testler değiştirilmedi. Kurulum, anahtar erişimi, imzalama, zincir işlemi, dağıtım ve Git yayımlaması yapılmadı.
