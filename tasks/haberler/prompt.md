Bugünün Türkiye gazetesini hazırla. Bu dizindeki `x-1.md`, `x-2.md`, `x-3.md`, `x-4.md` ve `bundle.md` dosyalarını `Read` ile oku: ilk dördü haber hesaplarının ve gazetecilerin son 24 saatte X'te attığı gönderiler, hesap grubuna ve hesaba göre (her gönderide beğeni ve yanıt sayısı ve gönderinin x.com bağlantısı var), `bundle.md` ise Bundle uygulamasının popüler listesi ve akışı (Gazete Oksijen, Euronews Türkçe, Independent Türkçe gibi kaynaklar). Beşini de tamamen oku, sonra yazmaya başla. Tarih bağlamında yazıyor.

Amaç: Türkiye'de ne olup bittiğini takip etmek. Siyasetten ekonomiye, toplumdan magazine, bir gazete gibi genel; ama sadece gerçekten olan ve önemli olan şeyler. Okuyucu Türkiye gündemini gün gün takip etmiyor; bir haberin arkasındaki süreci bilmeyebilir.

Kaynakları böyle kullan:
- Bağımsız, sol, muhalif ve uluslararası kaynaklar ana kaynağın. Sol kaynaklar emek, sendika ve toplumsal muhalefet haberlerini başka yerde bulamayacağın kadar iyi verir; onları da gazeteye taşı. Aynı haber birden çok grupta ve hesapta varsa önemlidir; beğeni ve yanıt sayıları ile Bundle'ın popüler listesi de bunun için.
- En çok takip edilen haber hesapları (Pusholder, BPT, Boşuna Tıklama gibi) gündemi hızlı yakalar ama kendi muhabirleri yoktur, başkasının haberini kısaltır ve bazen abartır. Gündemin ne olduğunu anlamak için kullan; bir haberi yalnızca onlar veriyorsa ve bir gazete ya da ajans doğrulamıyorsa ya atla ya da iddia olarak ver. Ajans Muhbir bir partiye yakındır, siyasi çerçevesini alma.
- Gazetecilerin gönderileri çoğu zaman kendi haberleri ya da yorumlarıdır: haberi al, yorumu alma.
- Doğrulama hesapları (teyit, Doğruluk Payı) bir iddianın yanlış çıktığını söylüyorsa bunu haberde belirt, yanlış iddiayı haber gibi verme.
- İktidara yakın ve resmi kaynakları sadece olgu için kullan: resmi açıklama, mahkeme kararı, atama, rakam. Çerçevelemelerini, övgü dilini ve "müjde" haberlerini alma. Bir haberi yalnızca bu grup veriyorsa ve içeriği propaganda kokuyorsa atla; gerçek bir gelişme ise tek cümleyle ve nötr ver.
- Kaynaklar aynı olayı farklı anlatıyorsa bunu bir cümleyle belirt ("X'e göre ... , Y ise ... diyor").

Şunları tamamen atla: tıklama tuzağı ("şok", "bakın ne oldu", "o isim", "herkes bunu konuşuyor"), burç, "günün fırsatı", listeler, sınav ve maaş hesaplama rehberleri, hava durumu, trafik, köşe yazıları, aynı olayın tekrar başlıkları, kaynağı belli olmayan sosyal medya dedikoduları.

Ekonomi haberlerinde rakam varsa rakamı yaz: kur, enflasyon, faiz kararı, zam oranı.

Arka plan: bir haber devam eden bir sürecin parçasıysa (bir soruşturma, bir dava, bir siyasi süreç, bir ekonomik program, bir tartışma) ve başlığı ilk kez duyan biri ne olduğunu anlamayacaksa, haberin altına "Ne olmuştu?" bloğu ekle: süreç ne, ne zaman ve nasıl başladı, taraflar kim, bugüne kadar ne oldu. İki veya üç sade cümle. Sadece gerektiğinde; kendi başına anlaşılan bir habere ekleme. Emin olmadığın arka planı uydurma: gönderide haberin kendi bağlantısı varsa `WebFetch` ile aç, çoğu haberde arka plan paragrafı olur; oradan da çıkmıyorsa bloğu yazma. En büyük 3-4 haberin olgularını da aynı şekilde kontrol et. x.com bağlantıları `WebFetch` ile açılmaz, onları deneme.

Gazeteyi yapılandırılmış çıktı olarak ver: bir `title`, sonra sırayla `sections`; her bölümün bir `heading` ve `stories` listesi var. Her haberde `headline` (sade, tek cümlelik başlık), `body` (ne olduğunu ve neden önemli olduğunu anlatan iki veya üç sade cümle, markdown), gerekiyorsa `context` (yukarıda anlatılan "Ne olmuştu?" arka planı, iki veya üç cümle; gerekmiyorsa alanı hiç yazma), `source` (haberi en iyi veren gönderinin x.com bağlantısı ya da Bundle'daki haber bağlantısı, dosyadan aynen kopyalanmış çıplak URL; aynı haberi birden çok hesap verdiyse bağımsız, sol, muhalif ya da uluslararası bir kaynağınkini seç) ve `importance` var.

`importance` haberin sayfadaki büyüklüğü: bölümün en büyük bir veya iki haberi için 3, normal haber için 2, kısa haber için 1. Kısa haber tek cümlelik `body` ile verilir: bir atama, bir rakam, bir maç sonucu, bir küçük gelişme. Bir haber paragraf etmiyor ama bilinmeye değerse atlamak yerine kısa haber yap.

`title`: "📰 Türkiye Gazetesi, <tarih>" (örnek: "📰 Türkiye Gazetesi, 19 Eylül 2026").

Bölüm başlıkları, sırayla: 🏛️ Gündem ve Siyaset, 💸 Ekonomi, 🏙️ Toplum ve Yaşam, 🌍 Dünya (Türkiye'yi ilgilendirdiği kadar), 🎭 Kültür, Sanat ve Magazin, ⚽ Spor. Boş kalan bölümü yazma. Her bölümde 3-6 normal haber (importance 2 veya 3), gerekirse birkaç kısa haber (importance 1). `lead` alanını kullanma.

Dil Türkçe, sade ve gazete gibi, yorum yok, süs yok. Metnin içinde emoji kullanma, sadece bölüm başlıklarında. Her haberin bir `source` bağlantısı olmalı.

Yalnızca yapılandırılmış çıktıyı ver; öncesinde veya sonrasında metin yazma.
