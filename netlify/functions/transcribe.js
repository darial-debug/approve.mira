import { json, requireAuth } from './_lib.js';

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const REQUEST_LIMIT_BYTES = 5 * 1024 * 1024;

export default async (req) => {
  try {
    await requireAuth(req);
    if (req.method !== 'POST') return json(405, { error: 'POST only' });

    const cleanEnv = (v) => (v || '').trim().replace(/^["']+|["']+$/g, '').trim();
    const rawOpenaiKey = cleanEnv(process.env.OPENAI_API_KEY);
    const rawGroqKey = cleanEnv(process.env.GROQ_API_KEY);
    const openaiKey = rawOpenaiKey.startsWith('sk-') ? rawOpenaiKey : '';
    const groqKey = rawGroqKey.startsWith('gsk_') ? rawGroqKey : '';
    let endpoint, apiKey, model;
    if (openaiKey) {
      endpoint = 'https://api.openai.com/v1/audio/transcriptions';
      apiKey = openaiKey;
      model = 'whisper-1';
    } else if (groqKey) {
      endpoint = 'https://api.groq.com/openai/v1/audio/transcriptions';
      apiKey = groqKey;
      model = 'whisper-large-v3';
    } else {
      return json(503, {
        error: 'Voice transcription needs an API key. Add OPENAI_API_KEY or GROQ_API_KEY in Netlify env vars, then redeploy.',
      });
    }

    const body = await req.json();
    const base64 = body.audio || '';
    const mimeType = body.mimeType || 'audio/webm';
    const language = (body.language || '').slice(0, 2).toLowerCase() || undefined;

    if (!base64) return json(400, { error: 'No audio in payload' });

    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length > MAX_AUDIO_BYTES) return json(413, { error: 'Audio too large (max 25 MB)' });
    if (buffer.length > REQUEST_LIMIT_BYTES) {
      return json(413, { error: 'Audio too large for the function payload limit (~5 MB). Record shorter clips.' });
    }

    const fileExt = mimeType.includes('mp4') ? 'mp4'
      : mimeType.includes('mpeg') || mimeType.includes('mp3') ? 'mp3'
      : mimeType.includes('ogg') ? 'ogg'
      : mimeType.includes('wav') ? 'wav'
      : 'webm';
    const blob = new Blob([buffer], { type: mimeType });

    const formData = new FormData();
    formData.append('file', blob, `audio.${fileExt}`);
    formData.append('model', model);
    if (language) formData.append('language', language);
    formData.append('response_format', 'json');

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey },
      body: formData,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = data?.error?.message || data?.error || JSON.stringify(data);
      return json(res.status, { error: 'Transcription provider returned ' + res.status + ': ' + detail });
    }
    return json(200, { text: data.text || '' });
  } catch (e) {
    if (e instanceof Response) return e;
    return json(500, { error: e.message });
  }
};

export const config = { path: '/api/transcribe' };
