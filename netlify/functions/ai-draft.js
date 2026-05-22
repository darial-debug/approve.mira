import { json, requireAuth, readData } from './_lib.js';
import { draftApproval, validateApproval } from './_ai_drafts.js';

// POST /api/ai-draft
//   mode=draft (default): { messages, images?, source? } → { needsMoreInfo, question, proposed }
//   mode=validate:        { draft: { title, category, fields, approverIds } } → { ready, required, suggestions, question }
export default async (req) => {
  try {
    if (req.method !== 'POST') return json(405, { error: 'POST only' });
    const me = await requireAuth(req);
    if (!process.env.GROQ_API_KEY) {
      return json(503, { error: 'AI is not configured. Set GROQ_API_KEY in Netlify env vars (get a free key at https://console.groq.com/).' });
    }
    const body = await req.json();
    const allUsers = await readData('users', []);
    const allProjects = await readData('projects', []);

    if (body.mode === 'validate') {
      const draft = body.draft;
      if (!draft?.title && !draft?.category) return json(400, { error: 'draft with title and category required' });
      const result = await validateApproval({ draft, requester: me, allUsers, allProjects });
      return json(200, result);
    }

    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (!messages.length) return json(400, { error: 'messages required' });
    const images = Array.isArray(body.images) ? body.images : [];
    const source = body.source || 'web';

    const result = await draftApproval({ messages, images, requester: me, allUsers, allProjects, source });
    return json(200, result);
  } catch (e) {
    if (e instanceof Response) return e;
    return json(500, { error: e.message });
  }
};

export const config = { path: '/api/ai-draft' };
