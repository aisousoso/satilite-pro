const express = require('express');
const ytdl = require('@distube/ytdl-core');
const axios = require('axios'); // نحتاجها للاتصال بـ API يوتيوب
const http = require('http');
const https = require('https');

const app = express();

// 1. إعداد المنفذ والمفتاح
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.YOUTUBE_API_KEY || 'ضع_مفتاحك_هنا_للتجربة_المحلية'; 

// إعدادات وكيل لتحسين الاتصال لـ ytdl
const agentOptions = { keepAlive: true, maxSockets: 256 };
const httpsAgent = new https.Agent(agentOptions);

app.use(express.static('public'));

// دالة مساعدة لتنسيق الحجم
function formatBytes(bytes) {
    if (!bytes || bytes === '0') return 'غير معروف';
    const mb = bytes / (1024 * 1024);
    return mb.toFixed(2) + ' MB';
}

// 2. مسار البحث (باستخدام API الرسمي)
app.get('/api/search', async (req, res) => {
    try {
        const query = req.query.q;
        if (!query) return res.status(400).json({ error: 'كلمة البحث مطلوبة' });

        // طلب البحث من يوتيوب الرسمي
        const response = await axios.get('https://www.googleapis.com/youtube/v3/search', {
            params: {
                part: 'snippet',
                maxResults: 20,
                q: query,
                type: 'video',
                key: API_KEY
            }
        });

        // تحويل بيانات API لتتناسب مع شكل البيانات الذي تتوقعه الواجهة
        const items = response.data.items.map(item => ({
            videoId: item.id.videoId,
            title: item.snippet.title,
            thumbnail: item.snippet.thumbnails.medium.url,
            channelTitle: item.snippet.channelTitle,
            publishedAt: item.snippet.publishedAt,
            description: item.snippet.description
        }));

        res.json({ items: items });

    } catch (error) {
        console.error('❌ Search API Error:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'خطأ في البحث عبر API يوتيوب' });
    }
});

// 3. مسار الفيديوهات الرائجة (باستخدام API الرسمي)
app.get('/api/trending', async (req, res) => {
    try {
        // المنطقة يمكن تغييرها إلى SA للسعودية أو EG لمصر إلخ
        const regionCode = req.query.region || 'SA'; 
        
        const response = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
            params: {
                part: 'snippet,contentDetails,statistics',
                chart: 'mostPopular',
                regionCode: regionCode,
                maxResults: 20,
                key: API_KEY
            }
        });

        const items = response.data.items.map(item => ({
            videoId: item.id,
            title: item.snippet.title,
            thumbnail: item.snippet.thumbnails.medium.url,
            channelTitle: item.snippet.channelTitle,
            viewCount: item.statistics.viewCount,
            duration: item.contentDetails.duration // بصيغة ISO8601
        }));

        res.json({ items: items });

    } catch (error) {
        console.error('❌ Trending API Error:', error.message);
        res.status(500).json({ error: 'خطأ في جلب الترند' });
    }
});

// 4. مسار تفاصيل فيديو محدد (باستخدام API الرسمي)
app.get('/api/video/:id', async (req, res) => {
    try {
        const videoId = req.params.id;
        const response = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
            params: {
                part: 'snippet,contentDetails,statistics',
                id: videoId,
                key: API_KEY
            }
        });

        if (response.data.items.length === 0) {
            return res.status(404).json({ error: 'الفيديو غير موجود' });
        }

        const item = response.data.items[0];
        res.json({
            videoId: item.id,
            title: item.snippet.title,
            description: item.snippet.description,
            thumbnail: item.snippet.thumbnails.high.url,
            channelTitle: item.snippet.channelTitle,
            viewCount: item.statistics.viewCount,
            likeCount: item.statistics.likeCount,
            publishedAt: item.snippet.publishedAt
        });

    } catch (error) {
        res.status(500).json({ error: 'خطأ في جلب التفاصيل' });
    }
});

// 5. مسار معلومات التحميل (ما زال يستخدم ytdl-core لأن API لا يعطي رابط التحميل)
app.get('/api/download/:id', async (req, res) => {
    console.log('📥 طلب معلومات التحميل:', req.params.id);
    try {
        const videoId = req.params.id;
        
        const options = {
            requestOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                },
                agent: httpsAgent
            }
        };

        const info = await ytdl.getBasicInfo(videoId, options);
        const streamingData = info.player_response?.streamingData;
        
        if (!streamingData) {
            return res.status(400).json({ error: 'الفيديو غير متاح للتحميل.' });
        }

        const allFormats = [...(streamingData.formats || []), ...(streamingData.adaptiveFormats || [])];
        
        const qualities = allFormats
            .filter(f => f.url && f.mimeType)
            .map(f => ({
                itag: f.itag,
                quality: f.qualityLabel || (f.mimeType.includes('audio') ? 'صوت فقط' : 'فيديو'),
                mimeType: f.mimeType,
                size: f.contentLength ? formatBytes(f.contentLength) : 'غير معروف',
                url: f.url
            }))
            .slice(0, 10);

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

app.listen(PORT, () => {
    console.log(`🚀 السيرفر يعمل على المنفذ ${PORT}`);
    if(API_KEY === 'ضع_مفتاحك_هنا_للتجربة_المحلية') {
        console.log('⚠️ تنبيه: لم يتم تعيين YOUTUBE_API_KEY. البحث قد لا يعمل.');
    } else {
        console.log('✅ YouTube API Key is set.');
    }
});
