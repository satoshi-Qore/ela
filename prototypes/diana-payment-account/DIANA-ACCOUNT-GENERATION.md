# Diana hesap üretim aracı — 7B-3

**Karar: READY — araç kullanıcı oturumunda çalıştırılabilir.** EFS şifrelemesi, kullanıcı oturumu ve kasa erişimi kontrolleri üretim sırasında uygulanır. Bağımsız EFS kurtarma provası tamamlanmadı. PFX yedeğinin ayrı bir Windows profilinde dosyaları açabildiği henüz doğrulanmadı.

## Araç ve dosya düzeni

- [diana-create-accounts.mjs](diana-create-accounts.mjs) kurulu `@qorechain/sdk` 0.14.0 ile her rol için bağımsız 256 bit BIP-39 mnemonic ve kanonik QoreChain hesabı türetir. Native ve EVM adresleri aynı hesap gövdesine bağlanır. Adres çakışması ve keystore adresi uyuşmazlığı reddedilir. Native ve EVM ağları aynı adres biçimini kullanabilir. Hesapların yalnız Diana’da kullanılması operasyon kuralıdır. Araç ağa bağlanmaz. [QoreChain SDK](https://github.com/qorechain/qorechain-sdk)
- [prepare-diana-vault.ps1](prepare-diana-vault.ps1) ayrı Codex hesabını, yönlendirilmiş girdiyi ve etkileşimli olmayan oturumu reddeder. Sabit yerel NTFS, yönlendirme olmayan yol, EFS, kasa sahibi ve erişim listesi denetlenir. Erişim listesinde yalnız oturum sahibi, SYSTEM ve yerel Administrators grubuna izin verilir. Kasa, Git deposunun yanında ayrı dizindedir. Kasa ve sürücü kökünde Git metaverisi aranır, kasa içeriği listelenmez. Onaydan sonra yalnız yeni hesap klasörü ve sıfır baytlık hedefler oluşturulur. EFS niteliği her hedefte gizli veri yazılmadan kontrol edilir. Mevcut hesap klasörünün üstüne yazılmaz. [EFS komutları](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/cipher)
- [diana-keystore.mjs](diana-keystore.mjs) mevcut viem 2.57.19 ve Node.js kriptografisini kullanır. Üretimde rastgele salt, IV, UUID ve rol başına rastgele parola ile Web3 Secret Storage V3 (PBKDF2-HMAC-SHA256, 600.000 tur, AES-128-CTR, Keccak-256 MAC) oluşturur. Yeni bağımlılık kurulmadı. [Ethereum Web3 Secret Storage](https://ethereum.org/developers/docs/data-structures-and-encoding/web3-secret-storage/)
- `E:\ELA-PRIVATE-VAULT\Diana-9800-accounts` altında `deployer`, `invoice-owner`, `executor` ve `recipient` önekleriyle ikişer dosya oluşturulur. `<rol>.v3.json` Ethereum anahtarını ayrıca şifreler. `<rol>.recovery.json` EFS içinde mnemonic, keystore parolası ve yeniden türetme bilgilerini tutar. Kurtarma dosyasının disk koruması EFS’ye dayanır. Keystore ve kurtarma dosyaları ayrı koruma varmış gibi birlikte dışarı aktarılmamalıdır. JavaScript SDK gizli değerleri bellekte kullanır. Tam bellek silme garantisi verilemez. Kullanımdan sonra yerel süreç kapanır.
- Başarı çıktısı dört JSON satır girdisi şeklinde yalnızca `role`, `evm` ve `native` alanlarını içerir. Onay istemi ve sabit hata metinleri gizli veri içermez. Araç dosya yazımı sırasında durursa klasör kısmen dolu kalabilir. Otomatik yeniden deneme veya üzerine yazma yerine yalnızca kullanıcı oturumunda düzeltme gerekir.

## Kurtarma ve kullanıcının tek komutu

### Açık risk: Bağımsız EFS kurtarma provası

Kullanıcı, EFS şifrelemesini ve parola korumalı PFX yedeğini doğruladı. Bağımsız kurtarma provası tamamlanmadığı için kullanıcı profili veya EFS anahtarı kaybedilirse kurtarma dosyalarının geri yüklenebilirliği belirsizdir. Kurtarma provası üretim kararını engellemez.

Üretim için kendi Windows oturumunuzda çevrimdışı olarak aşağıdaki tek komutu çalıştırın. İstemde `GENERATE DIANA TEST ACCOUNTS` yazmak dört hesabın oluşturulmasına açık onay verir. Bu alana parola veya mnemonic girmeyin.

```powershell
node .\diana-create-accounts.mjs
```

Komut `prototypes\diana-payment-account` klasöründe, bu dalın güncel kopyasıyla çalıştırılır. Başarı çıktısı yalnız dört rolün genel EVM ve Native adreslerini ve PQC genel anahtarının SHA-256 parmak izini içerir.

## Doğrulama

- Yayımlanmış Ethereum vektöründen beklenen adres, AES şifreli veri, KDF alanları ve MAC birebir elde edildi. Yönlendirilmiş onay girdisi hesap verisi üretmeden reddedildi. [Üretim aracı testleri](diana-account-generation.test.mjs)
- **2/2 yeni test ve 2/2 mevcut kriptografi testi geçti.** PowerShell kasa denetimi Codex hesabını kasa kontrolüne geçmeden reddetti. Kullanıcının oturumundaki başarılı kasa yolu ve gerçek hesap kurtarma bu çalışmada yürütülmedi.
- Git index SHA-256 değeri `668E955F212D74B3CD800087279472E8F5BE7E3424D27CBB8C5EAAB8D94951E7` olarak kaldı. Mevcut ELA kaynakları değiştirilmedi. Gerçek hesap, özel anahtar, zincir işlemi, kayıt veya fon aktarımı oluşturulmadı.

## Kanonik PQC anahtarı — 7C-5

Invoice Owner dahil her rolün ML-DSA-87 anahtarı, SDK 0.14.0’ın kanonik ve adrese bağlı türetimidir: `deriveUnifiedAccount(mnemonic, 0).pqc`, `derivePqcCanonical(qor1, mnemonic)` ile aynıdır. Anahtar mnemonic’ten yeniden üretilebildiği için ayrı PQC anahtar dosyası yazılmaz; ikinci bir yedek gerekmez.

- [diana-canonical-pqc.mjs](diana-canonical-pqc.mjs) kasaya yazmadan önce anahtarın kanonik olduğunu, 2.592 bayt olduğunu ve `validateRegisteredPqcKey('hybrid', …)` denetiminden geçtiğini doğrular. Yalnız algoritma kimliğini ve genel anahtarın SHA-256 parmak izini döndürür. Kendi hesapladığı gizli kopyayı sıfırlar.
- Üretici, kurtarma kaydına `pqc: { derivation: 'canonical', algorithmId: 1, pqcPublicKeySha256 }` genel alanını ekler ve hesabın PQC gizli tamponunu kullanım sonrasında sıfırlar.
- Ayrı anahtar üreticisi [diana-create-invoice-pqc.mjs](diana-create-invoice-pqc.mjs) silinmedi ve değiştirilmedi. Kanonik yol seçildiğinde Invoice Owner için çalıştırılmamalıdır.
- **Mevcut hesaplar (7C-5B).** Önceki biçimdeki kurtarma kaydı (`mnemonic`, `password`, `index`, `sdkVersion`; `pqc` alanı yok) yeniden üretim gerektirmez. `verifyRecoveryRecord(record, { native, evm })` kanonik anahtarı `deriveUnifiedAccount(mnemonic, index)` ile yeniden türetir, bilinen genel adreslerle karşılaştırır ve yalnız genel parmak izini döndürür. Kaydı okumak kullanıcının kendi oturumundadır; fonksiyon dosya okumaz, yazmaz.
- Testler yalnız herkese açık BIP-39 test mnemonic’ini kullanır: [kanonik PQC testleri](test/diana-canonical-pqc.test.mjs). Gerçek hesap üretilmedi, kasaya erişilmedi.

## Mevcut Invoice Owner kaydının doğrulanması — 7C-6

[diana-verify-recovery.mjs](diana-verify-recovery.mjs) yalnız kullanıcının kendi etkileşimli Windows terminalinde çalışır. Yönlendirilmiş girdiyi kasaya dokunmadan reddeder. `VERIFY DIANA INVOICE OWNER` onayından sonra yalnız `invoice-owner.recovery.json` dosyasını okur: dosya sıradan, en fazla 4 KiB ve EFS şifreli olmalıdır, salt okuma kipinde açılır. Hesap bellekte türetilir ve bilinen genel adreslerle karşılaştırılır. Terminale yalnız rol, `MATCH`, adresler, türetim indeksi, algoritma kimliği ve PQC genel anahtarının SHA-256 parmak izi yazılır. Araç dosya yazmaz, ağ isteği göndermez, mnemonic, parola veya anahtar göstermez. Okunan baytlar ve türetilen ML-DSA-87 gizli tamponları sonuç ne olursa olsun sıfırlanır. JavaScript dizeleri (mnemonic ve SDK’nın döndürdüğü hex özel anahtar) silinemez; süreç işlem sonunda kapanır.

```powershell
node .diana-verify-recovery.mjs
```

Testler yalnız herkese açık test mnemonic’iyle çalışır: [doğrulayıcı testleri](test/diana-verify-recovery.test.mjs). Gerçek kasa okunmadı.
