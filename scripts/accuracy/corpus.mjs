// Original MIT study data. These are development/training data, never the final test set.
// Whole phrases are split by authorship, not by random rows from a template family.
export const lines = text => text.trim().split('\n').map(x => x.trim()).filter(Boolean);
const train = {
network_check: [
`Diana için erişim testi yapabilir miyiz?
Test ortamının bağlantısını yoklar mısın?
Zincirin yanıt verdiğinden emin olmak istiyorum.
Bugün Diana'ya bağlanabiliyor muyuz acaba?
Bağlantımız düzgün mü, öğrenelim.
Ağ tarafında bir kesinti gözüküyor mu?
Sistemin test ağına ulaşıp ulaşamadığını söyle.
Diana'dan yanıt alabiliyor musun?
Test zinciri çevrimiçi görünüyor mu?
Bağlantı sağlığını gözden geçirmeni rica ediyorum.
Şebeke değil, Diana test ağı erişimini soruyorum.
Ağın ayakta olup olmadığını anlamak istiyorum.
Zincire bağlantı kurulabiliyor mu diye bak.
Erişim kontrolünün sonucunu öğrenmek isterim.
Testnet bağlantımız kopmuş olabilir mi?
Ortamın erişilebilirliğini sorgulayabilir misin?
Diana cevap veriyor gibi mi?
Test ağıyla konuşabiliyor muyuz?
Şu bağlantıyı bir denetleyelim.
Zincir tarafında erişim sorunu var mı acaba?
Sağlıklı bir ağ bağlantımız var mı?
Yanıt alıp alamadığımızı kontrol et lütfen.
Testnet hizmet veriyor mu, bakar mısın?
Ağdaki bağlantı durumunu merak ediyorum.
Diana bağlantısına kısa bir kontrol istiyorum.
Şuan test ağı erişime açık mı?
Ag baglantimiz duzgun calisiyor mu?
Diana erisimi kontrol edermisin?
Test agina ulasabiliyormuyuz?
Baglanti durumuna bakarmisin?`,
`Could you see whether our Diana connection responds?
I'd like a connectivity check on the test environment.
Please find out if the test chain can be reached.
Do we have a healthy connection to Diana today?
Can the application talk to the chain at all?
Look for a connectivity problem on this testnet.
I'd like to know whether the network is available.
Has Diana stopped responding to us?
Would you inspect the test chain connection?
Is our connection to the test environment alive?
See whether Diana is answering requests.
I'm wondering if we can reach the network.
Give me a quick check of Diana's availability.
We need to know if the chain is up.
Check whether the test network answers us.
Does the Diana endpoint respond at present?
Find out whether the chain is accessible.
Is there a problem connecting to the testnet?
I'd appreciate a network connectivity check.
Would you look at the health of our connection?
Could the test chain be unavailable?
Please inspect Diana's reachability for me.
Can we communicate with the test network?
Give the Diana connection a quick look.
Is testnet connectivity behaving normally?
Check if Diana is alive and reachable.
Is the netwrok responding to us?
Please chekc Diana connectivity.
Is our conection to Diana healthy?
Can you chek if testnet responds?`],
block_number: [
`Diana zincirinde ulaşılan yükseklik kaç olmuş?
En son üretilen blok hangi numarayı taşıyor?
Test ağındaki blok yüksekliğini okumak istiyorum.
Zincirin son bloğunun sıra numarasını bildirir misin?
Şu anda zincirde hangi yükseklikteyiz?
Yeni bloğun numarasına bakmak istiyorum.
Blok yüksekliğinin en güncel değerini getir.
Testnetin ulaştığı son blok seviyesi nedir?
Diana hangi yüksekliğe kadar ilerlemiş?
Blok numarası için güncel bir okuma alalım.
Zincir yüksekliğine ilişkin son değeri göster.
Şu son bloğun kaçıncı blok olduğunu söyle.
Ulaşılan blok numarasını öğrenebilir miyiz?
Zincirdeki mevcut yüksekliği kontrol eder misin?
En yeni blok kaç numaralı?
Test ağının blok sayacı nereye geldi?
Diana'nın şimdiki blok indeksini istiyorum.
Son bloğa ait numarayı okumak mümkün mü?
Güncel zincir yüksekliğini getirir misin acaba?
Şu blok yüksekliği kaç oldu şimdi?
Zincirin vardığı yüksekliği merak ettim.
Blok sırasının güncel değerini görebilir miyim?
En son yükseklik ölçümünü alabilir misin?
Test zinciri kaç numaralı bloğu tamamlamış?
Bloğun sıra numarası için bir okuma yap.
Blok yuksekligi suan kac?
Son blok numarasina bakarmisin acaba?
Guncel bolk yuksekligini getir.
Blok yukseklik degerini ogrenmek istiyorum.
Diana kac numarali bloka geldi?`,
`What height has the Diana chain reached today?
I'd like the number of the newest produced block.
Read the test chain's current block counter.
Which numbered block is the most recent one?
Tell me how high the chain has grown in blocks.
Could you look up the present block index?
Give me a reading of the latest chain height.
I'd like to see the most recent block number.
What's the height of the test chain at present?
Read the current height rather than an old one.
Check which block the network is currently on.
May I have the chain's latest block counter?
Look up the number attached to the newest block.
I'm interested in Diana's current block height.
How far up the block sequence are we?
Fetch the newest available block index.
Could you obtain the last produced block's number?
What numbered block has Diana just reached?
Please report the most up to date chain height.
Show me where the block counter stands.
I need a fresh value for the chain height.
Get the height of the latest produced block.
Read Diana's present position in the block sequence.
Could you check the highest block number available?
Show the test chain's most recent height reading.
What is the curent blok height?
Read the lattest block nummber.
Chek the newest block hight.
Whats the chain heigth now please?
Get Diana's last bolck number.`],
follow_up_repeat: [
`Az önceki kontrolü bir tur daha alalım.
Aynı okumayı tekrar yapmanı rica ediyorum.
Önceki sorguya yeniden dönelim.
Bir daha aynı sonucu sorgula.
Yaptığın kontrolü baştan alır mısın?
Tekrarla lütfen, aynı sorgu olsun.
Son baktığın şeyi bir kez daha dene.
Bir kontrol daha, yine aynı konuda.
Önceki okumanı tekrarlamak istiyorum.
Yeniden aynı yere bakabilir miyiz?
Aynısını bir daha öğrenelim.
Son kontrolü yeniler misin acaba?
O sorguyu bir kez daha çalıştır.
Tekrardan aynı okumayı alalım.
Son kontrolün tekrarı lütfen.`,
`I'd like another go at the previous check.
Could you redo that particular reading for me?
One more of the same query, please.
Repeat the check you just performed.
Go back and read that same thing again.
I'd appreciate another reading of that.
Do the last query once more for me.
Could we repeat what you looked up?
Try the identical check another time.
Take a second reading of the same thing.
Let's revisit that exact query.
I'd like to rerun the last read.
Again please, the same check as before.
Please repeat that previous lookup.
One more time for that last reading.`],
follow_up_current: [
`Peki onun güncel durumu nasıl?
O değer şimdi ne olmuş acaba?
Şimdilik hangi değeri gösteriyor?
Peki aynı şey şu anda ne diyor?
O zamandan beri nereye geldi?
Şu dakikadaki değeri nedir peki?
Peki güncel olarak nasıl görünüyor?
Şimdiki durumunu merak ediyorum.
O son değer şimdi kaç olmuş?
Bu arada değişti mi acaba?
Güncel haliyle ne durumda peki?
Şu an itibarıyla nasıl?
O şeyin şimdiki değerine bakalım.
Peki şu saniyede ne olmuş?
En güncel hali nasıl görünüyor?`,
`And where is that value at present?
How does that look at this moment?
What's its reading as of now?
And where does that stand today?
Is that value any different now?
What's the situation with that currently?
And the updated reading would be?
How is that looking as we speak?
What has that value become meanwhile?
And at this exact moment?
Where is it standing right now then?
What does the same thing look like now?
What about its present state?
And how does it compare at the moment?
So what's that reading now?`],
unsupported: [
`Diana ağındaki doğrulayıcıların sıralamasını merak ediyorum.
Zincirin günlük aktif kullanıcı sayısını bul.
Testnetin ortalama blok süresini hesaplar mısın?
QOR fiyatının aylık grafiğini çiz.
Ağdaki bütün hesapların listesini göster.
Bu hafta kaç işlem yapılmış öğrenelim.
Zincirin yıllık enflasyonunu karşılaştır.
Blok üretim hızının geçmişini getir.
Doğrulayıcıların komisyon oranlarını listele.
Ağın toplam kilitli değerini öğrenmek istiyorum.
En yoğun saatlerdeki işlem hacmini söyle.
Diana'nın yönetişim oylamalarını özetle.
Blok üreticilerinin kimliklerini sıralar mısın?
Test zincirinin günlük büyüme grafiği lazım.
Zincirdeki en zengin hesap kim?`,
`I'd like a chart of monthly chain activity.
List the validators ranked by voting power.
Can you calculate the average block interval?
Find the daily active account count.
Show Diana's full historical throughput series.
Give me the token price over the last month.
List all accounts participating in governance.
Which validator has the largest delegation?
Find the network's total value locked.
Summarize the chain's inflation history.
Compare last month's transaction volumes.
I'd like a list of block producer identities.
Can you show the full validator commission table?
Find the busiest hour on the test chain.
Read the network's entire governance history.`],
unknown: [
`Bir şey soracağım ama daha karar vermedim.
Diana hakkında bir yazı yazabilir misin?
Ağ kavramını bana basitçe anlat.
Blok yüksekliği ile blok süresi aynı şey mi?
Az önceki konuşmayı unut, başka bir konu var.
Numara derken neyi kastettiğimi bilmiyorum.
Yükseklik kelimesinin anlamı nedir?
Bağlantı sorunlarını genel olarak nasıl çözersin?
Sadece deniyorum, henüz sorgu istemiyorum.
Onu değil öteki şeyi soruyordum.
Dur bakalım, önce bir düşüneyim.
Hangi ağı seçmeliyim sence?
Bir blok resmi çizebilir misin?
Diana bir insan adı da olabilir mi?
Sonuçlara henüz bakmak istemiyorum.
Ağ mı blok mu, bilemedim.
Bu yazıyı Türkçeye çevir.
Lütfen herhangi bir sorgu yapma.
Tam olarak ne sorduğumu anlamadım.
Şimdilik sadece sohbet ediyorum.`,
`I'd like an explanation of what a block height means.
Write a short story about Diana.
I'm not asking for a network check yet.
What's the difference between a chain and a network?
Could you draw a picture of a block?
I haven't decided which question to ask.
That wasn't what I meant at all.
Let's talk about something unrelated.
Translate this sentence into Turkish.
I don't need a reading at the moment.
Is Diana also a person's name?
How would someone troubleshoot connectivity in general?
I might ask about blocks later on.
Please don't look anything up for now.
I don't know whether I mean height or status.
What do you think of this interface?
Hold on while I decide what to ask.
Explain the word availability to me.
This is only a casual conversation.
I'm thinking about a different topic.`],
};
export const studyTraining = Object.entries(train).flatMap(([label, groups]) => groups.flatMap((s,i)=>lines(s).map(text=>({text,label,lang:i?'en':'tr'}))));

// Authored before fitting. Development is the ONLY set available to model selection.
const dev = {
network_check: ['Diana bağlantısında kesinti var mı diye inceleyebilir misin?|Zincirden normal yanıt geliyor mu acaba?|Test ortamının bağlantısı sağlam mı?|Diana erişiminin sağlıklı olduğunu denetle.|Ağla iletişim kuruluyor mu, bakabilir miyiz?|Test zincirine erişimde sorun gözüküyor mu?',
"Would you see if Diana can answer us today?|Check whether we can establish contact with testnet.|I'd like to know if the test chain is responding properly.|Could you inspect whether Diana is reachable from here?|Find out whether our chain connection is alive.|Is communication with the test network healthy?"],
block_number: ['Test zincirinin vardığı son yükseklik kaç?|Şimdiki blok indeksini görebilir miyiz?|Diana zincirinin son blok sayacını oku.|Güncel zincir yüksekliği için bir değer getir.|Üretilmiş en yeni bloğun sırası ne?|Blok numarası bugün nereye kadar gelmiş?',
"Read the chain height most recently reported by Diana.|What's the number on the newest available block?|I'd like a current value for the block counter.|Tell me the latest height of our test chain.|Which block index is Diana at right now?|Get the most recent chain height measurement."],
follow_up_repeat: ['Son yaptığın okumayı bir kere daha dene.|Aynı kontrol için yeniden bakalım.|Önceki sorguyu bir kez daha alabilir miyim?|Tekrar o son kontrole dön.|Bir okuma daha, öncekiyle aynı olsun.|Az evvel yaptığını tekrar okuyalım.',
"Please do another pass of that last check.|I'd like to repeat your earlier reading.|Can you perform the identical lookup once more?|Let's have another reading of that same thing.|Redo the last thing you looked up for me.|Please go back to that previous check again."],
follow_up_current: ['O bilgi şu an ne durumda peki?|Peki onun değeri şimdi nasıl?|Şu anda aynı değer ne gösteriyor?|Güncel olarak o şey nasıl görünüyor?|Az önceki bilgi şimdi değişti mi?|Şimdiki haliyle durum nedir acaba?',
"And what is that reading at this point?|Where is that same value now then?|How does it stand at the present moment?|And is that different as of now?|What does its updated state look like?|What about the value at this time?"],
unsupported: ['Ağdaki aktif hesapların günlük sayısını çıkar.|Doğrulayıcıların oy gücünü karşılaştır.|Son ayın blok üretim grafiğini göster.|Test ağının geçmiş işlem hacmini hesapla.|Yönetişim kararlarının özetini getir.|Zincirdeki toplam arzın geçmişini listele.',
"Give me a weekly chart of validator performance.|Calculate the daily number of active chain accounts.|Show a timeline of network inflation.|List the governance votes from last month.|Compare the validators by their commission rates.|Read the history of total supply on this chain."],
unknown: ['Blok yüksekliğini tanımlayan bir paragraf yaz.|Henüz hiçbir kontrol istemiyorum.|Ağ hakkında sormam gerekeni bilmiyorum.|Diana sözcüğünü bir cümlede kullan.|Bana bu sonucu nasıl okuyacağımı öğret.|O değil başka bir şey demek istedim.',
"I only want a definition of network availability.|I'm not ready to request any lookup.|Write a paragraph explaining block numbering.|That question wasn't what I intended.|Tell me a story involving a chain.|I haven't chosen what to look up yet."],
};
export const development = Object.entries(dev).flatMap(([label,groups])=>groups.flatMap((s,i)=>s.split('|').map((text,j)=>({text,label,lang:i?'en':'tr',group:label.startsWith('follow')?'follow_up':label==='unknown'?'ambiguous':label==='unsupported'?'unsupported':'safe',context:label.startsWith('follow')?(j%2?'network_check':'block_number'):'none',expect:label==='network_check'||label==='block_number'?'run:'+label:label.startsWith('follow')?'run:'+(j%2?'network_check':'block_number'):'no_run'}))));
