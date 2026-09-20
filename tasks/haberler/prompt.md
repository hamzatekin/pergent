Bugünün Türkiye gazetesini hazırla. Bu dizindeki `haberler-1.md`, `haberler-2.md`, `haberler-3.md` ve `bundle.md` dosyalarını `Read` ile oku: ilk üçü son 24 saatin haber başlıkları kaynak grubuna göre, `bundle.md` ise Bundle uygulamasının popüler listesi ve akışı (Gazete Oksijen, Euronews Türkçe, Independent Türkçe gibi kaynaklar). Dördünü de tamamen oku, sonra yazmaya başla. Tarih bağlamında yazıyor.

Amaç: Türkiye'de ne olup bittiğini takip etmek. Siyasetten ekonomiye, toplumdan magazine, bir gazete gibi genel; ama sadece gerçekten olan ve önemli olan şeyler. Okuyucu Türkiye gündemini gün gün takip etmiyor; bir haberin arkasındaki süreci bilmeyebilir.

Kaynakları böyle kullan:
- Bağımsız, sol, muhalif ve uluslararası kaynaklar ana kaynağın. Sol kaynaklar emek, sendika ve toplumsal muhalefet haberlerini başka yerde bulamayacağın kadar iyi verir; onları da gazeteye taşı. Aynı haber birden çok grupta varsa önemlidir; Google News satırındaki kaynak sayısı ve Bundle'ın popüler listesi de bunun için.
- İktidara yakın ve resmi kaynakları sadece olgu için kullan: resmi açıklama, mahkeme kararı, atama, rakam. Çerçevelemelerini, övgü dilini ve "müjde" haberlerini alma. Bir haberi yalnızca bu grup veriyorsa ve içeriği propaganda kokuyorsa atla; gerçek bir gelişme ise tek cümleyle ve nötr ver.
- Kaynaklar aynı olayı farklı anlatıyorsa bunu bir cümleyle belirt ("X'e göre ... , Y ise ... diyor").

Şunları tamamen atla: tıklama tuzağı ("şok", "bakın ne oldu", "o isim", "herkes bunu konuşuyor"), burç, "günün fırsatı", listeler, sınav ve maaş hesaplama rehberleri, hava durumu, trafik, köşe yazıları, aynı olayın tekrar başlıkları, kaynağı belli olmayan sosyal medya dedikoduları.

Ekonomi haberlerinde rakam varsa rakamı yaz: kur, enflasyon, faiz kararı, zam oranı.

Arka plan: bir haber devam eden bir sürecin parçasıysa (bir soruşturma, bir dava, bir siyasi süreç, bir ekonomik program, bir tartışma) ve başlığı ilk kez duyan biri ne olduğunu anlamayacaksa, haberin altına "Ne olmuştu?" bloğu ekle: süreç ne, ne zaman ve nasıl başladı, taraflar kim, bugüne kadar ne oldu. İki veya üç sade cümle. Sadece gerektiğinde; kendi başına anlaşılan bir habere ekleme. Emin olmadığın arka planı uydurma: `WebFetch` ile haberin bağlantısını aç, çoğu haberde arka plan paragrafı olur; oradan da çıkmıyorsa bloğu yazma. En büyük 3-4 haberin olgularını da aynı şekilde kontrol et. Google News bağlantıları yönlendirme olduğundan mümkünse gazetenin kendi bağlantısını tercih et.

Gazeteyi yapılandırılmış çıktı olarak ver: bir `title`, sonra sırayla `sections`; her bölümün bir `heading` ve `stories` listesi var. Her haberde `headline` (sade, tek cümlelik başlık), `body` (ne olduğunu ve neden önemli olduğunu anlatan iki veya üç sade cümle, markdown), gerekiyorsa `context` (yukarıda anlatılan "Ne olmuştu?" arka planı, iki veya üç cümle; gerekmiyorsa alanı hiç yazma) ve `source` (kaynağın bağlantısı, çıplak URL) var.

`title`: "📰 Türkiye Gazetesi, <tarih>" (örnek: "📰 Türkiye Gazetesi, 19 Eylül 2026").

Bölüm başlıkları, sırayla: 🏛️ Gündem ve Siyaset, 💸 Ekonomi, 🏙️ Toplum ve Yaşam, 🌍 Dünya (Türkiye'yi ilgilendirdiği kadar), 🎭 Kültür, Sanat ve Magazin, ⚽ Spor. Boş kalan bölümü yazma. Her bölümde 3-6 haber. `lead` alanını kullanma.

Dil Türkçe, sade ve gazete gibi, yorum yok, süs yok. Metnin içinde emoji kullanma, sadece bölüm başlıklarında. Her haberin bir `source` bağlantısı olmalı.

Yalnızca yapılandırılmış çıktıyı ver; öncesinde veya sonrasında metin yazma.
