import { json, requireAuth, readData } from './_lib.js';
import { draftApproval } from './_ai_drafts.js';

// POST /api/ai-draft  { messages: [...], images?: [...], source?: 'web'|'slack' }
// Returns: { needsMoreInfo, question, proposed }
export default async (req) => {
  try {
    if (req.method !== 'POST') return json(405, { error: 'POST only' });
    const me = await requireAuth(req);
    if (!process.env.GROQ_API_KEY) {
      return json(503, { error: 'AI is not configured. Set GROQ_API_KEY in Netlify env vars (get a free key at https://console.groq.com/).' });
    }
    const body = await req.json();
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (!messages.length) return json(400, { error: 'messages required' });
    const images = Array.isArray(body.images) ? body.images : [];
    const source = body.source || 'web';

    const allUsers = await readData('users', []);
    const allProjects = await readData('projects', []);
    const result = await draftApproval({ messages, images, requester: me, allUsers, allProjects, source });
    return json(200, result);
  } catch (e) {
    if (e instanceof Response) return e;
    return json(500, { error: e.message });
  }
};

export const config = { path: '/api/ai-draft' };
