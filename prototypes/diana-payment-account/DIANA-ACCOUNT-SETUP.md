# Diana test hesapları ve anahtar hazırlığı — 7B-1

**Karar: READY — hazırlık tamamlandı.** Anahtar üretimi için açık kullanıcı onayı ve kullanıcının kendi Windows oturumunda şifreli saklama ile kurtarma kontrolü bekleniyor. Bu aşamada hesap, kasa, gizli değer, imza veya zincir işlemi oluşturulmadı. Bu plan [7A hazırlık raporunu](DIANA-DEPLOYMENT-PREP.md) esas alır.

## 1. Hesap rolleri ve ayrıştırma

| Rol | Yetki ve karar |
|---|---|
| Deployer | Sözleşmeyi tek sefer dağıtır. Dağıtım için gereken kısa, hedef listesi boş EVM penceresini kullanır. Executor’dan ayrı hesap ve ayrı mnemonic. |
| Invoice owner | Native hesapta ML-DSA-87 anahtarını sahiplik kanıtıyla kaydeder. Faturanın ham 32 baytlık özetini imzalayan tek roldür. Ayrı hesap ve ayrı mnemonic. Kayıt için sınırlı testnet gazı. |
| Executor | Önceden imzalanmış faturayı iletir. EVM penceresi yalnızca prototip sözleşmesini kabul eder. Ayrı hesap ve ayrı mnemonic. İşlem gazı için sınırlı bakiye. |
| Recipient | Sabit, yalnızca Diana’da kullanılan alıcı adresi. Sözleşme yetkisi veya PQC kaydı gerekmez. Normal tercih ayrı bir kullanıcı denetimli testnet EOA’sı. |

Deployer ile Recipient teknik olarak birleştirilebilir: dağıtım penceresi kapatıldıktan sonra alıcı pasif kalır ve sözleşme deployer'a özel harcama yetkisi vermez. Bu birleşim tek operatörlü demo için kabul edilebilir, bağımsız alıcıya ödeme kanıtı gerekiyorsa dört ayrı adres kullanılır. Deployer ile Executor ayrımı, daha geniş dağıtım yetkisini dar ödeme penceresinden ayırır. Invoice owner ile Executor ayrımı, tek anahtarın hem fatura yetkisi hem yürütme yetkisi sağlamasını önler. Executor ve Recipient ayrı kalır, böylece yürütücünün fon ve gaz hareketleri açıkça ayırt edilir. Fatura sahibinin ödemenin alıcısı olmaması da rol ayrımını korur. [Constructor ve ödeme kontrolleri](src/DianaPaymentAccount.sol#L61) · [EVM pencere kapsamı](https://docs.qorechain.io/developer-guide/evm-window-reference/)

## 2. Yerel şifreli saklama

Önerilen konum, kullanıcının kendi Windows profilinde, eşitlenmeyen yerel bir NTFS biriminde `%LOCALAPPDATA%\ELA-Diana-Vault\`. Bu dizin ve fiziksel hedefi Git çalışma alanlarının dışında olmalı. Yönlendirme veya junction varsa gerçek hedefi doğrula. Klasöre kullanıcıya özgü erişim listesi uygula ve kullanıcının EFS sertifikası ile dosya şifrelemesini etkinleştir. `icacls` ile erişim listesini, `cipher /c` ve dosyanın `Encrypted` özniteliği ile şifrelemeyi önce gizli değer içermeyen deneme dosyasında kontrol et. BitLocker etkinse disk düzeyinde ek koruma sağlar. EFS dosyayı oturum sahibi için saydam açar. Bu nedenle anahtar işlemleri ayrı, güvenilen kullanıcı oturumunda yapılır ve ajan erişiminden uzak tutulur. EFS desteği, doğru sertifika ve kurtarma provası kullanıcı oturumunda doğrulanana kadar üretim bekler. Araçların sistemde bulunması kasanın hazır olduğunu göstermez. [Microsoft EFS](https://learn.microsoft.com/en-us/windows/win32/fileio/file-encryption) · [Microsoft cipher](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/cipher)

Kasa kurulmadan ve deneme dosyasında şifreleme doğrulanmadan üretici çalıştırılmaz. İleride yalnızca gerekli kurtarma kaydı doğrudan şifrelenmiş dosyaya yazılır. Klasörün özniteliği ile her dosyanın şifreli özniteliği kontrol edilir. İşlem sürecinden yalnızca rol, adres, genel anahtar ve genel anahtar parmak izi çıkar. Türetilen özel anahtarları diske ayrıca yazmak gerekmiyor.

## 3. Sızıntı önleme ve Git kontrolü

- Gizli materyal iş alanlarında, `.env` dosyalarında, komut satırı argümanlarında, pano, terminal çıktısı, transcript, hata dökümü, ekran görüntüsü ve bulut eşitleme alanında tutulmaz. Gelecekteki yerel aracın SDK’dan dönen hesabı bütünüyle yazdırması veya serileştirmesi engellenir.
- Üretici gelecekte yalnızca izin verilen kasa dizinine yazacak şekilde incelenir. Hedefin fiziksel yolu depo dışı olmalı. Dosya mevcutsa üstüne yazmayı reddetmeli. Yeni dosya önceden doğrulanmış şifreli klasörde kalmalı. Bu aşamanın ağ kontrol betiğinde yazma, gizli girdi veya hesap üretme yolu yoktur.
- Git ön kontrolü `git rev-parse --show-toplevel` ile depo kökünü doğrular. Kasa içinden `git -C "<kasa>" rev-parse --is-inside-work-tree` başarısız olmalı. Üretim öncesi ve sonrası `git --no-optional-locks status --short` ve `git diff --cached --name-only` yalnızca dosya adları üzerinden denetlenir. Kasa dosyası görünürse aktarım durdurulur. Gönderilecek dosyalar gelecekte tek tek seçilir. Çalışma alanı dışında doğrulanmış fiziksel konum ana kontroldür.

## 4. Yedekleme ve kurtarma

1. Üretim öncesi EFS kurtarma yöntemini gerçek anahtar içermeyen dosyayla dene. Kullanıcı EFS sertifikası ve özel anahtarını `cipher /x` veya Windows sertifika yöneticisiyle parola korumalı PFX olarak dışa aktarır. PFX çevrimdışı tutulur. Kasa yedeği ile sertifika ve kurtarma parolası ayrı yerlerde korunur.
2. Üretimden sonra yedek, ayrı şifreli çevrimdışı ortama alınır. Hedef kopyanın şifreli olduğu doğrulanır. Normal kopyalama sırasında EFS davranışı hedef dosya sistemine bağlıdır, şifreleme korunacağı varsayılmaz. Kullanıcı parolaları bu rapora veya Codex’e girmez.
3. Çevrimdışı kurtarma provasında denetimli ikinci oturumda yedek erişimi ve sertifika geri yüklemesi doğrulanır. Kullanıcı aynı SDK sürümü ve türetim yoluyla Native/EVM adresleri ve PQC genel anahtarını yeniden elde eder. Yalnızca bu genel değerler kayıtla karşılaştırılır. Kurtarma provası bitmeden fon yüklenmez. Kurtarma kopyaları güvenli biçimde kaldırılır. [Microsoft EFS yedekleme davranışı](https://learn.microsoft.com/en-us/windows/win32/fileio/file-encryption) · [Sertifika yedekleme komutu](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/cipher)

## 5. Kullanıcıya gösterilecek üretim adımları

1. **Bekleyen onay, yalnızca izole Diana hesaplarının yerel üretimi.** Kullanıcı seçilen rolleri, kasa konumunu ve hesabın yalnız Diana için kullanılacağını onaylar. Bu adım herhangi bir kayıt, fon talebi veya imza yetkisi vermez.
2. Kullanıcı kendi Windows oturumunda kasa konumunu ve şifreleme/kurtarma deneme dosyasını doğrular. İncelenmiş üretici ağ erişimi olmadan çalışır. Bu görevde üretici çalıştırılmadı.
3. Her bağımsız rol için mevcut SDK’nın `generateMnemonic(256)` ve `deriveUnifiedAccount(mnemonic, 0)` yolu kullanılır. SDK 0.14.0 bildirimi `m/44'/60'/0'/0/0` ve hesap adresine bağlı kanonik PQC türetimini tanımlar. `qoreAddresses` ile Native ve EVM adreslerinin aynı 20 baytlık adresi temsil ettiğini, rollerin farklı olduğunu kontrol et. Recipient yalnız alacaksa PQC kaydı yapılmaz. Mnemonic, SDK sürümü ve türetim bilgisi kullanıcı kasasında tutulur, genel adresler ayrı kayıt edilir. [Kurulu SDK bildirimi](../../node_modules/@qorechain/sdk/dist/index.d.ts#L2496) · [QoreChain anahtar bağlama](https://docs.qorechain.io/build-before-qday/key-binding/)
4. Kullanıcı, yalnız genel adresleri ve gerekiyorsa genel anahtar parmak izlerini paylaşır. Kasa ve kurtarma denetimi tamamlanınca kayıt ve gaz planı hazırlanabilir.

## 6. Ağ doğrulaması, gaz tahmini ve sonraki onaylar

Prototip dizininde [diana-account-preflight.ps1](diana-account-preflight.ps1) çalıştır. Betiğin iki sabit uç noktası vardır. `eth_chainId` için `https://evm-testnet.qore.host/` ve Native `GET /status` için `https://rpc-testnet.qore.host/status`. Yönlendirme kapalıdır. EVM yanıtı `0x2648` ve Native yanıtı eşzamanlanmış `qorechain-diana` göstermeli. Bu kontrolü daha sonraki her onaylı işlemden hemen önce tekrarla. Farklı ağ, eşzamanlanmamış düğüm veya bağlantı hatasında dur. [Resmî Diana uç noktaları](https://docs.qorechain.io/getting-started/connecting-to-testnet/)

- EVM tarafında gas tahmini için `eth_estimateGas`, ücret için `eth_gasPrice` ve desteklenirse `eth_feeHistory` kullan. Adresler, bakiye ve sözleşme durumu hazırsa gerçek işlem alanlarıyla tahmin yap. Bu çağrılar zincir işlemi yayınlamaz ve pencere kabulünü kanıtlamaz. Önceki yerel Forge gazı yalnız referanstır.
- Native tarafta güncel işlem parametreleri ve resmî ücret tabanı ile kayıt ve pencere işlemleri için muhafazakâr üst sınır hazırla. Kesin mesajlar oluşturulduğunda Cosmos REST `/cosmos/tx/v1beta1/simulate` salt-okunur simülasyonu kullanılabilir. Uç noktanın ilgili PQC mesajını ve imzasız zarfı kabul ettiği bu çalışmada doğrulanmadı. Simülasyon eksikse, imza üretmeden bekleyen bütçe tahminini koşullu olarak bildir.
- Rol bazında gaz ve ödenecek testnet QOR ayrı hesaplanır. EVM pencere bütçesi, kabul edilecek işlem değeri ve gaz tavanı × ücret tavanını uqor cinsinden, zincirin yukarı yuvarlamasıyla içerir. Kullanıcı toplam üst bütçeyi belirlemeden faucet isteği, fon aktarımı veya dağıtım yapılmaz. [EVM pencere hesabı](https://docs.qorechain.io/developer-guide/evm-window-reference/) · [SDK ve ücret tabanı](https://docs.qorechain.io/developer-tools/chain-dev-sdk/)
- Sonraki onay noktaları sırasıyla yerel hesap üretimi, tutarı belirli testnet fonu, PoP imzası ve kayıt yayını, pencere açma ve dağıtım, sözleşmeye fonlama, tek fatura imzası ve gerekirse ayrı ödeme yayını ile pencere kapatma işlemleridir. Her adımın adres ve limitleri 7A planına göre açıkça sunulur.

## 7. Doğrulama

| Kontrol | Sonuç |
|---|---|
| Canlı salt-okunur prova | **PASS.** EVM 9800, Native `qorechain-diana`, Native yükseklik 10.204.787 ve eşzamanlanmış düğüm. |
| Betiğin yerel yanıt denemeleri | **5/5 PASS.** Geçerli Diana kabul edildi. Yanlış EVM kimliği, yanlış Native kimliği, eşzamanlanmamış düğüm ve bozuk alan tipi reddedildi. Yerel denemelerde ağ kullanılmadı. |
| Yetki denetimi | Betik sadece sabit `eth_chainId` ve `GET /status` çağrılarını yapar. Anahtar, girdi dosyası, zincir işlemi ve fonlama yolları yoktur. |
| Solidity | **29/29 PASS.** Yerel Forge çevrimdışı koşusu mevcut derleme çıktısını kullandı. |
| Kriptografi | **2/2 PASS.** Yayımlanmış vektörü ve değişiklik reddini yerel olarak doğruladı. |
| Git index | Önce ve sonra SHA-256 `668E955F212D74B3CD800087279472E8F5BE7E3424D27CBB8C5EAAB8D94951E7`. Mevcut ELA kaynakları değiştirilmedi. |
