const express = require('express');
const yts = require('yt-search');
const ytdl = require('@distube/ytdl-core');
const http = require('http');
const https = require('https');
const { CookieJar } = require('tough-cookie');
const { HttpCookieAgent, HttpsCookieAgent } = require('http-cookie-agent/http');

const app = express();

// 1. استخدام المنفذ الديناميكي المطلوب لمنصات الاستضافة مثل Render
const PORT = process.env.PORT || 3000;

// 2. إعداد "جرار الكوكيز" و الوكلاء (Agents) لتجاوز حظر يوتيوب
const cookieJar = new CookieJar();
const httpAgent = new HttpCookieAgent({ cookies: { jar: cookieJar } });
const httpsAgent = new HttpsCookieAgent({ cookies: { jar: cookieJar } });

app.use(express.static('public'));

// دالة لتنسيق الحجم
function formatBytes(bytes) {
    if (!bytes || bytes === '0') return 'غير معروف';
    const mb = bytes / (1024 * 1024);
    return mb.toFixed(2) + ' MB';
}

// مسار الفيديوهات الرائجة
app.get('/api/trending', async (req, res) => {
    try {
        // نبحث عن كلمات مفتاحية رائجة كمحاكاة
        const result = await yts('trending music videos'); 
        res.json({ items: result.videos.slice(0, 20) });
    } catch (error) {
        res.status(500).json({ error: 'خطأ في جلب البيانات الرائجة' });
    }
});

// مسار البحث
app.get('/api/search', async (req, res) => {
    try {
        const query = req.query.q;
        if (!query) return res.status(400).json({ error: 'كلمة البحث مطلوبة' });
        
        const result = await yts(query);
        res.json({ items: result.videos.slice(0, 20) });
    } catch (error) {
        res.status(500).json({ error: 'خطأ في عملية البحث' });
    }
});

// مسار تفاصيل الفيديو
app.get('/api/video/:id', async (req, res) => {
    try {
        const result = await yts({ videoId: req.params.id });
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: 'خطأ في جلب التفاصيل' });
    }
});

// مسار معلومات التحميل (النسخة المحسنة والمؤمنة)
app.get('/api/download/:id', async (req, res) => {
    console.log('📥 جاري جلب معلومات التحميل لـ:', req.params.id);
    try {
        const videoId = req.params.id;
        
        // خيارات متقدمة جداً لتجاوز قيود يوتيوب على السيرفرات
        const options = {
            requestOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
                    'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
                },
                agent: httpsAgent // استخدام الوكيل الذي يدعم الكوكيز
            }
        };

        // جلب المعلومات الأساسية
        const info = await ytdl.getBasicInfo(videoId, options);
        const streamingData = info.player_response?.streamingData;
        
        if (!streamingData) {
            return res.status(400).json({ error: 'الفيديو غير متاح للتحميل أو محمي بحقوق النشر.' });
        }

        const allFormats = [...(streamingData.formats || []), ...(streamingData.adaptiveFormats || [])];
        
        // تصفية وتنظيم الصيغ المتاحة (فيديو وصوت)
        const qualities = allFormats
            .filter(f => f.url && f.mimeType)
            .map(f => ({
                itag: f.itag,
                quality: f.qualityLabel || (f.mimeType.includes('audio') ? 'صوت فقط' : 'فيديو'),
                mimeType: f.mimeType,
                size: f.contentLength ? formatBytes(f.contentLength) : 'غير معروف',
                url: f.url
            }))
            .slice(0, 10); // نأخذ أفضل 10 صيغ فقط لتخفيف الحمل

        res.json({
            title: info.videoDetails?.title || 'فيديو بدون عنوان',
            thumbnail: info.videoDetails?.thumbnails?.[0]?.url || '',
            duration: info.videoDetails?.lengthSeconds || '',
            qualities: qualities
        });

    } catch (error) {
        console.error('❌ خطأ التحميل:', error.message);
        // إرسال رسالة خطأ واضحة للمستخدم
        res.status(500).json({ 
            error: 'فشل جلب بيانات التحميل. قد يكون الفيديو محمياً أو أن يوتيوب حظر الطلب المؤقت.',
            details: error.message 
        });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 السيرفر يعمل بنجاح على المنفذ ${PORT}`);
});
