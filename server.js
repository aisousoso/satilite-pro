const express = require('express');
const yts = require('yt-search');
const ytdl = require('@distube/ytdl-core');
const axios = require('axios'); // للاتصال بـ YouTube Data API
const http = require('http');
const https = require('https');

const app = express();

// 1. إعداد المنفذ الديناميكي (مهم جداً لـ Render)
const PORT = process.env.PORT || 3000;

// 2. إعداد مفتاح API (يؤخذه من البيئة أو يكون فارغاً)
const API_KEY = process.env.YOUTUBE_API_KEY || '';

// 3. إعدادات الوكيل (Agents) لتحسين الاتصال وتجنب الحظر
const agentOptions = {
    keepAlive: true,
    keepAliveMsecs: 10000,
    maxSockets: 256,
    maxFreeSockets: 256,
};
const httpsAgent = new https.Agent(agentOptions);

app.use(express.static('public'));

// دالة مساعدة لتنسيق حجم الملف
function formatBytes(bytes) {
    if (!bytes || bytes === '0') return 'غير معروف';
    const mb = bytes / (1024 * 1024);
    return mb.toFixed(2) + ' MB';
}

// ==========================================
// مسارات البحث والترند (تستخدم API إن وجد)
// ==========================================

// مسار الفيديوهات الرائجة
app.get('/api/trending', async (req, res) => {
    console.log('📡 طلب الفيديوهات الرائجة...');
    try {
        let items = [];

        if (API_KEY) {
            // استخدام YouTube API الرسمي (الأفضل والأسرع)
            const response = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
                params: {
                    part: 'snippet,contentDetails,statistics',
                    chart: 'mostPopular',
                    regionCode: 'SA', // يمكن تغييرها إلى EG, US, etc.
                    maxResults: 20,
                    key: API_KEY
                }
            });
            items = response.data.items.map(item => ({
                videoId: item.id,
                title: item.snippet.title,
                thumbnail: item.snippet.thumbnails.medium.url,
                channelTitle: item.snippet.channelTitle,
                viewCount: item.statistics.viewCount,
                publishedAt: item.snippet.publishedAt
            }));
        } else {
            // العودة لـ yt-search إذا لم يوجد مفتاح
            const result = await yts('trending music videos');
            items = result.videos.slice(0, 20);
        }

        res.json({ items: items });
    } catch (error) {
        console.error('❌ Trending Error:', error.message);
        res.status(500).json({ error: 'خطأ في جلب البيانات الرائجة' });
    }
});

// مسار البحث
app.get('/api/search', async (req, res) => {
    console.log('📡 طلب بحث:', req.query.q);
    try {
        const query = req.query.q;
        if (!query) return res.status(400).json({ error: 'كلمة البحث مطلوبة' });

        let items = [];

        if (API_KEY) {
            // استخدام YouTube API الرسمي للبحث
            const response = await axios.get('https://www.googleapis.com/youtube/v3/search', {
                params: {
                    part: 'snippet',
                    maxResults: 20,
                    q: query,
                    type: 'video',
                    key: API_KEY
                }
            });
            items = response.data.items.map(item => ({
                videoId: item.id.videoId,
                title: item.snippet.title,
                thumbnail: item.snippet.thumbnails.medium.url,
                channelTitle: item.snippet.channelTitle,
                publishedAt: item.snippet.publishedAt,
                description: item.snippet.description
            }));
        } else {
            // العودة لـ yt-search
            const result = await yts(query);
            items = result.videos.slice(0, 20);
        }

        res.json({ items: items });
    } catch (error) {
        console.error('❌ Search Error:', error.message);
        res.status(500).json({ error: 'خطأ في عملية البحث' });
    }
});

// مسار تفاصيل فيديو محدد
app.get('/api/video/:id', async (req, res) => {
    try {
        const videoId = req.params.id;
        // نستخدم yts هنا لأنه يجلب التفاصيل بسهولة سواء مع API أو بدونه
        const result = await yts({ videoId: videoId });
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: 'خطأ في جلب التفاصيل' });
    }
});

// ==========================================
// مسار التحميل (يستخدم ytdl-core دائماً)
// ==========================================
app.get('/api/download/:id', async (req, res) => {
    console.log('📥 طلب معلومات التحميل:', req.params.id);
    try {
        const videoId = req.params.id;
        
        if (!videoId || videoId.length !== 11) {
            return res.status(400).json({ error: 'معرف الفيديو غير صالح' });
        }

        // خيارات متقدمة لتجاوز قيود يوتيوب على السيرفرات
        const options = {
            requestOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
                },
                agent: httpsAgent
            }
        };

        const info = await ytdl.getBasicInfo(videoId, options);
        const streamingData = info.player_response?.streamingData;
        
        if (!streamingData) {
            return res.status(400).json({ error: 'الفيديو غير متاح للتحميل أو محمي بحقوق النشر.' });
        }

        const allFormats = [...(streamingData.formats || []), ...(streamingData.adaptiveFormats || [])];
        
        // تصفية وتنظيم الصيغ المتاحة
        const qualities = allFormats
            .filter(f => f.url && f.mimeType)
            .map(f => ({
                itag: f.itag,
                quality: f.qualityLabel || (f.mimeType.includes('audio') ? 'صوت فقط' : 'فيديو'),
                mimeType: f.mimeType,
                size: f.contentLength ? formatBytes(f.contentLength) : 'غير معروف',
                url: f.url
            }))
            .slice(0, 10); // نأخذ أفضل 10 صيغ فقط

        res.json({
            title: info.videoDetails?.title || 'فيديو بدون عنوان',
            thumbnail: info.videoDetails?.thumbnails?.[0]?.url || '',
            duration: info.videoDetails?.lengthSeconds || '',
            qualities: qualities
        });

    } catch (error) {
        console.error('❌ Download Info Error:', error.message);
        res.status(500).json({ 
            error: 'فشل جلب بيانات التحميل.',
            details: error.message 
        });
    }
});

// تشغيل السيرفر
app.listen(PORT, () => {
    console.log(`=========================================`);
    console.log(`🚀 السيرفر يعمل بنجاح على المنفذ ${PORT}`);
    if (API_KEY) {
        console.log('✅ YouTube API Key is Active (High Performance)');
    } else {
        console.log('⚠️ No API Key found. Using fallback search mode.');
    }
    console.log(`=========================================`);
});
