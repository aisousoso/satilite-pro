const express = require('express');
const yts = require('yt-search');
const ytdl = require('@distube/ytdl-core');
const http = require('http');
const https = require('https');

const app = express();

// 1. استخدام المنفذ الذي توفره منصة الاستضافة (Render) أو 3000 محلياً
const PORT = process.env.PORT || 3000;

// 2. إعدادات وكيل (Agent) لتجنب الحظر من يوتيوب وتحسين الاتصال
const agentOptions = {
    keepAlive: true,
    keepAliveMsecs: 10000,
    maxSockets: 256,
    maxFreeSockets: 256,
    scheduling: 'lifo',
};

const httpAgent = new http.Agent(agentOptions);
const httpsAgent = new https.Agent(agentOptions);

// دالة مساعدة لتنسيق حجم الملف
function formatBytes(bytes) {
    if (!bytes || bytes === '0') return 'غير معروف';
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return gb.toFixed(2) + ' GB';
    const mb = bytes / (1024 * 1024);
    return mb.toFixed(2) + ' MB';
}

app.use(express.static('public'));

// 1. مسار الفيديوهات الرائجة
app.get('/api/trending', async (req, res) => {
    console.log('📡 طلب الفيديوهات الرائجة...');
    try {
        // نبحث عن كلمات مفتاحية رائجة كمحاكاة
        const result = await yts('trending music videos 2026'); 
        console.log(`✅ تم جلب ${result.videos.length} فيديو`);
        res.json({ items: result.videos.slice(0, 20) });
    } catch (error) {
        console.error('❌ Trending API Error:', error.message);
        res.status(500).json({ error: 'خطأ في جلب البيانات الرائجة' });
    }
});

// 2. مسار البحث
app.get('/api/search', async (req, res) => {
    console.log('📡 طلب بحث:', req.query.q);
    try {
        const query = req.query.q;
        if (!query) {
            return res.status(400).json({ error: 'كلمة البحث مطلوبة' });
        }
        
        const result = await yts(query);
        console.log(`✅ تم جلب ${result.videos.length} نتيجة`);
        res.json({ items: result.videos.slice(0, 20) });
    } catch (error) {
        console.error('❌ Search API Error:', error.message);
        res.status(500).json({ error: 'خطأ في عملية البحث' });
    }
});

// 3. مسار تفاصيل فيديو
app.get('/api/video/:id', async (req, res) => {
    console.log('📡 طلب تفاصيل فيديو:', req.params.id);
    try {
        const videoId = req.params.id;
        if (!videoId || videoId.length !== 11) {
             return res.status(400).json({ error: 'معرف الفيديو غير صالح' });
        }

        const result = await yts({ videoId: videoId });
        console.log('✅ تم جلب الفيديو:', result.title);
        res.json(result);
    } catch (error) {
        console.error('❌ Video Details API Error:', error.message);
        res.status(500).json({ error: 'خطأ في جلب تفاصيل الفيديو' });
    }
});

// 4. مسار معلومات التحميل (الأكثر تعقيداً والمعدل للأمان)
app.get('/api/download/:id', async (req, res) => {
    console.log('📥 طلب معلومات التحميل:', req.params.id);
    try {
        const videoId = req.params.id;

        if (!videoId || videoId.length !== 11) {
            return res.status(400).json({ error: 'معرف الفيديو غير صالح' });
        }

        // إعدادات متقدمة لـ ytdl لتعمل على السيرفرات السحابية
        const options = {
            requestOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
                },
                agent: httpsAgent
            }
        };

        // جلب المعلومات الأساسية أولاً (أسرع وأقل عرضة للحظر)
        const info = await ytdl.getBasicInfo(videoId, options);
        
        const playerResponse = info.player_response;
        const streamingData = playerResponse?.streamingData;
        
        if (!streamingData) {
            return res.status(400).json({ error: 'الفيديو غير متاح للتحميل أو محمي بحقوق النشر (Streaming Data Missing)' });
        }

        const allFormats = [...(streamingData.formats || []), ...(streamingData.adaptiveFormats || [])];
        
        // تصفية التنسيقات للحصول على روابط قابلة للتحميل
        const downloadableFormats = allFormats.filter(f => f.url && f.mimeType);

        const qualities = downloadableFormats.map(f => ({
            itag: f.itag,
            quality: f.qualityLabel || (f.mimeType.includes('audio') ? 'Audio Only' : 'Unknown'),
            mimeType: f.mimeType,
            size: f.contentLength ? formatBytes(f.contentLength) : 'غير معروف',
            url: f.url // هذا الرابط مباشر ومؤقت
        })).sort((a, b) => {
            // محاولة ترتيب تقريبي للجودة
            const getRes = (q) => parseInt(q.match(/\d+/)) || 0;
            return getRes(b.quality) - getRes(a.quality);
        });

        res.json({
            title: info.videoDetails?.title || 'فيديو بدون عنوان',
            thumbnail: info.videoDetails?.thumbnails?.[0]?.url || '',
            duration: info.videoDetails?.lengthSeconds || '',
            qualities: qualities.slice(0, 10) // نرجع أفضل 10 صيغ لتخفيف الحمل
        });

    } catch (error) {
        console.error('❌ Download Info Error:', error.message);
        // إرسال رسالة خطأ واضحة للمستخدم
        res.status(500).json({ 
            error: 'فشل جلب بيانات التحميل. قد يكون الفيديو محمياً أو أن يوتيوب حظر الطلب المؤقت.',
            details: error.message 
        });
    }
});

// تشغيل السيرفر
app.listen(PORT, () => {
    console.log(`=========================================`);
    console.log(`🚀 السيرفر يعمل بنجاح!`);
    console.log(`🌐 المنفذ: ${PORT}`);
    console.log(`📡 يستخدم yt-search & ytdl-core`);
    console.log(`=========================================`);
});
