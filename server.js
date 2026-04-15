const express = require('express');
const yts = require('yt-search');
const ytdl = require('@distube/ytdl-core');
const axios = require('axios');
const http = require('http');
const https = require('https');
const { CookieJar } = require('tough-cookie');
const { HttpCookieAgent, HttpsCookieAgent } = require('http-cookie-agent/http');

const app = express();

// 1. إعداد المنفذ والمفتاح
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.YOUTUBE_API_KEY || '';

// 2. إعداد الوكيل المتقدم (الحل السحري لمشكلة التحميل على Render)
const cookieJar = new CookieJar();
const httpAgent = new HttpCookieAgent({ cookies: { jar: cookieJar } });
const httpsAgent = new HttpsCookieAgent({ cookies: { jar: cookieJar } });

app.use(express.static('public'));

function formatBytes(bytes) {
    if (!bytes || bytes === '0') return 'غير معروف';
    const mb = bytes / (1024 * 1024);
    return mb.toFixed(2) + ' MB';
}

// --- مسارات البحث والترند (تستخدم API Key) ---

app.get('/api/trending', async (req, res) => {
    try {
        let items = [];
        if (API_KEY) {
            const response = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
                params: { part: 'snippet,contentDetails,statistics', chart: 'mostPopular', regionCode: 'SA', maxResults: 20, key: API_KEY }
            });
            items = response.data.items.map(item => ({
                videoId: item.id, title: item.snippet.title, thumbnail: item.snippet.thumbnails.medium.url,
                channelTitle: item.snippet.channelTitle, viewCount: item.statistics.viewCount
            }));
        } else {
            const result = await yts('trending music');
            items = result.videos.slice(0, 20);
        }
        res.json({ items });
    } catch (error) {
        res.status(500).json({ error: 'خطأ في الترند' });
    }
});

app.get('/api/search', async (req, res) => {
    try {
        const query = req.query.q;
        if (!query) return res.status(400).json({ error: 'كلمة البحث مطلوبة' });
        
        let items = [];
        if (API_KEY) {
            const response = await axios.get('https://www.googleapis.com/youtube/v3/search', {
                params: { part: 'snippet', maxResults: 20, q: query, type: 'video', key: API_KEY }
            });
            items = response.data.items.map(item => ({
                videoId: item.id.videoId, title: item.snippet.title, thumbnail: item.snippet.thumbnails.medium.url,
                channelTitle: item.snippet.channelTitle, description: item.snippet.description
            }));
        } else {
            const result = await yts(query);
            items = result.videos.slice(0, 20);
        }
        res.json({ items });
    } catch (error) {
        res.status(500).json({ error: 'خطأ في البحث' });
    }
});

app.get('/api/video/:id', async (req, res) => {
    try {
        const result = await yts({ videoId: req.params.id });
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: 'خطأ في التفاصيل' });
    }
});

// --- مسار التحميل (يستخدم ytdl مع الوكلاء المتقدمين) ---

app.get('/api/download/:id', async (req, res) => {
    console.log('📥 جاري جلب روابط التحميل لـ:', req.params.id);
    try {
        const videoId = req.params.id;
        
        // الخيارات السحرية لتجاوز حظر يوتيوب
        const options = {
            requestOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    'Accept-Language': 'en-US,en;q=0.9',
                },
                agent: httpsAgent // هنا يكمن الحل: استخدام وكيل الكوكيز
            }
        };

        const info = await ytdl.getBasicInfo(videoId, options);
        const streamingData = info.player_response?.streamingData;
        
        if (!streamingData) {
            return res.status(400).json({ error: 'الفيديو محمي أو غير متاح.' });
        }

        const allFormats = [...(streamingData.formats || []), ...(streamingData.adaptiveFormats || [])];
        
        const qualities = allFormats
            .filter(f => f.url && f.mimeType)
            .map(f => ({
                itag: f.itag,
                quality: f.qualityLabel || (f.mimeType.includes('audio') ? 'صوت' : 'فيديو'),
                mimeType: f.mimeType,
                size: f.contentLength ? formatBytes(f.contentLength) : '?',
                url: f.url
            }))
            .slice(0, 8);

        res.json({
            title: info.videoDetails?.title,
            thumbnail: info.videoDetails?.thumbnails?.[0]?.url,
            duration: info.videoDetails?.lengthSeconds,
            qualities: qualities
        });

    } catch (error) {
        console.error('❌ Download Error:', error.message);
        res.status(500).json({ 
            error: 'فشل التحميل. يوتيوب قد يكون حظر الطلب مؤقتاً.',
            details: error.message 
        });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 السيرفر يعمل على المنفذ ${PORT}`);
    console.log(API_KEY ? '✅ API Key Active' : '⚠️ No API Key');
});
