const express = require('express');
const yts = require('yt-search');
const axios = require('axios'); // نستخدمه للاتصال بـ Invidious

const app = express();
const PORT = process.env.PORT || 3000;

// قائمة بخوادم Invidious الموثوقة (إذا توقف واحد نستخدم الآخر)
const INVIDIOUS_INSTANCES = [
    'https://vid.puffyan.us',
    'https://invidious.snopyta.org',
    'https://inv.tux.pizza'
];

app.use(express.static('public'));

// دالة لاختيار خادم عشوائي لتوزيع الحمل
function getRandomInstance() {
    return INVIDIOUS_INSTANCES[Math.floor(Math.random() * INVIDIOUS_INSTANCES.length)];
}

// 1. مسار البحث (ما زال يستخدم yt-search لأنه ممتاز في البحث)
app.get('/api/search', async (req, res) => {
    try {
        const query = req.query.q;
        if (!query) return res.status(400).json({ error: 'كلمة البحث مطلوبة' });
        const result = await yts(query);
        res.json({ items: result.videos.slice(0, 20) });
    } catch (error) {
        res.status(500).json({ error: 'خطأ في البحث' });
    }
});

// 2. مسار الترند
app.get('/api/trending', async (req, res) => {
    try {
        const result = await yts('trending music');
        res.json({ items: result.videos.slice(0, 20) });
    } catch (error) {
        res.status(500).json({ error: 'خطأ في الترند' });
    }
});

// 3. مسار التحميل (الحل السحري باستخدام Invidious)
app.get('/api/download/:id', async (req, res) => {
    console.log('📥 جاري جلب الروابط عبر Invidious لـ:', req.params.id);
    try {
        const videoId = req.params.id;
        const instance = getRandomInstance();
        
        // طلب المعلومات من خادم Invidious بدلاً من يوتيوب مباشرة
        const response = await axios.get(`${instance}/api/v1/videos/${videoId}`);
        const data = response.data;

        if (!data || !data.formatStreams) {
            return res.status(404).json({ error: 'الفيديو غير متاح أو محمي.' });
        }

        // تنسيق البيانات لتناسب واجهتك الأمامية
        const qualities = data.formatStreams.map(f => ({
            itag: f.itag,
            quality: f.qualityLabel || (f.type.includes('audio') ? 'صوت' : 'فيديو'),
            mimeType: f.type,
            size: 'غير معروف', // Invidious لا يعطي الحجم دائماً بدقة
            url: f.url // هذا رابط مباشر وآمن
        }));

        // إضافة الروابط التكيفية (Adaptive) إذا كانت متوفرة للجودات العالية
        if (data.adaptiveFormats) {
            data.adaptiveFormats.forEach(f => {
                qualities.push({
                    itag: f.itag,
                    quality: f.qualityLabel || (f.type.includes('audio') ? 'صوت عالي' : 'فيديو تكيفي'),
                    mimeType: f.type,
                    size: 'غير معروف',
                    url: f.url
                });
            });
        }

        res.json({
            title: data.title,
            thumbnail: data.videoThumbnails?.[0]?.url || '',
            duration: data.lengthSeconds,
            qualities: qualities.slice(0, 10) // أفضل 10 صيغ
        });

    } catch (error) {
        console.error('❌ Invidious Error:', error.message);
        res.status(500).json({ 
            error: 'فشل الاتصال بخادم التحميل. حاول مرة أخرى.',
            details: error.message 
        });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 السيرفر يعمل على المنفذ ${PORT}`);
    console.log(`✅ يستخدم Invidious API للتحميل (مضاد للحظر)`);
});
