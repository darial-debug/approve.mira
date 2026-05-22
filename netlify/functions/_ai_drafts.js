// Groq-powered draft extraction. Uses the OpenAI-compatible Chat Completions API.
//   - Text-only       → llama-3.3-70b-versatile (fast, great at JSON)
//   - With image(s)   → llama-3.2-90b-vision-preview (vision-capable)

const GROQ_BASE = 'https://api.groq.com/openai/v1';
const TEXT_MODEL = 'llama-3.3-70b-versatile';
const VISION_MODEL = 'llama-3.2-90b-vision-preview';

function cleanEnv(v) {
  return (v || '').trim().replace(/^["']+|["']+$/g, '').trim();
}

function buildSystemPrompt({ requester, allUsers, allProjects = [], source = 'app' }) {
  const teamList = allUsers
    .filter((u) => u.id !== requester.id)
    .map((u) => `- ${u.name} (${u.role})`)
    .join('\n');

  const projectList = allProjects.map((p) => `- ${p.name}`).join('\n') || '(none configured yet)';

  const sourceLine = source === 'slack'
    ? 'This came from a Slack message that the user forwarded — they want to capture it as an approval request quickly.'
    : '';

  return `You help users at Mira Creative draft approval requests in approve.mira.

Today is ${new Date().toISOString().split('T')[0]}.
The user creating this request: ${requester.name} (${requester.role}).
${sourceLine}

TEAM (use exact names when suggesting approvers):
${teamList || '(no other users yet)'}

PROJECTS (which project/entity this is on behalf of — match by name when relevant):
${projectList}

Categories:
- "payments" — money out: invoices, vendor payments, refunds, reimbursements. Always needs amount + currency + paymentType.
- "content" — content/marketing pieces that need sign-off (blog posts, social, ad copy, video edits).
- "other" — everything else.

Payment types (paymentType field):
- "payment"     — paying a vendor/contractor up front or per invoice (default).
- "refund"      — refunding someone (will require Proof of Payment from the original transaction to be attached).
- "postpayment" — payment is being requested AFTER the work was done / the service was used.

Your job:
1. Read the user's description (may include images).
2. If something critical is missing, ask ONE concise clarifying question — only if it really matters. For payments: amount + currency + which project are usually critical. For content: a link or summary is usually critical. Skip the question if you can reasonably infer.
3. Once you have enough, draft ONE approval request.

Respond with ONLY valid JSON (no markdown fences, no preamble).
When asking a clarifying question:
{"needsMoreInfo": true, "question": "one specific friendly question", "proposed": null}
When ready:
{
  "needsMoreInfo": false,
  "question": null,
  "proposed": {
    "title": "concise action-oriented title",
    "category": "payments|content|other",
    "fields": {
      "paymentType": "payment|refund|postpayment (only for payments)",
      "amount": number_or_null,
      "currency": "AED|USD|EUR|GBP (only for payments)",
      "vendor": "string (only for payments)",
      "purpose": "string (only for payments)",
      "link": "URL (only for content)",
      "projectName": "exact project name from list above, or empty",
      "dueDate": "YYYY-MM-DD or null",
      "description": "context details"
    },
    "suggestedApproverNames": ["Name1", "Name2"]
  }
}`;
}

export async function draftApproval({ messages, images = [], requester, allUsers, allProjects = [], source = 'app' }) {
  const apiKey = cleanEnv(process.env.GROQ_API_KEY);
  if (!apiKey) throw new Error('GROQ_API_KEY not configured');

  const systemPrompt = buildSystemPrompt({ requester, allUsers, allProjects, source });
  const hasImages = images.length > 0;
  const model = hasImages ? VISION_MODEL : TEXT_MODEL;

  // Build OpenAI-compatible messages.
  const openaiMessages = [{ role: 'system', content: systemPrompt }];
  messages.forEach((m, idx) => {
    const isLast = idx === messages.length - 1;
    const textPart = typeof m.content === 'string'
      ? m.content
      : (Array.isArray(m.content) ? m.content.find((b) => b.type === 'text')?.text || '' : '');
    if (isLast && hasImages && m.role === 'user') {
      const blocks = [{ type: 'text', text: textPart || 'Draft an approval from these images.' }];
      images.forEach((img) => {
        blocks.push({
          type: 'image_url',
          image_url: { url: `data:${img.mediaType || 'image/jpeg'};base64,${img.base64}` },
        });
      });
      openaiMessages.push({ role: 'user', content: blocks });
    } else {
      openaiMessages.push({ role: m.role, content: textPart });
    }
  });

  // Vision model on Groq doesn't accept json_object response_format; text model does.
  const body = {
    model,
    messages: openaiMessages,
    max_tokens: 1500,
    temperature: 0.3,
  };
  if (!hasImages) body.response_format = { type: 'json_object' };

  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data?.error?.message || data?.error || JSON.stringify(data);
    throw new Error(`Groq returned ${res.status}: ${detail}`);
  }
  const raw = data.choices?.[0]?.message?.content || '';
  const clean = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(clean);
  } catch {
    parsed = { needsMoreInfo: true, question: clean, proposed: null };
  }

  // Map suggested approver names → ids so the UI can pre-fill the path picker.
  if (parsed.proposed && Array.isArray(parsed.proposed.suggestedApproverNames)) {
    parsed.proposed.suggestedApproverIds = parsed.proposed.suggestedApproverNames
      .map((name) => allUsers.find((x) => x.name.toLowerCase() === name.toLowerCase())?.id)
      .filter(Boolean);
  }

  // Resolve AI's projectName → projectId so the UI can pre-select the dropdown.
  if (parsed.proposed?.fields?.projectName) {
    const match = allProjects.find((p) => p.name.toLowerCase() === parsed.proposed.fields.projectName.toLowerCase());
    if (match) parsed.proposed.fields.projectId = match.id;
  }

  return parsed;
}

function buildValidatePrompt({ requester, allUsers, allProjects = [] }) {
  const projectList = allProjects.map((p) => `- ${p.name}`).join('\n') || '(none configured yet)';
  const teamList = allUsers
    .filter((u) => u.id !== requester.id)
    .map((u) => `- ${u.name} (${u.role})`)
    .join('\n');

  return `You review a manually filled approval request in approve.mira before submission.

Today is ${new Date().toISOString().split('T')[0]}.
Submitter: ${requester.name} (${requester.role}).

BUSINESSES / PROJECTS (paid on behalf of):
${projectList}

TEAM (for approver suggestions only):
${teamList || '(no other users yet)'}

Categories: payments (needs amount, currency, paymentType, business/project), content (needs link or clear summary), other.

Payment types: payment, refund, postpayment. Refunds need POP + invoice mentioned in suggestions.

Your job:
1. Check what is missing or weak in the submitted draft JSON.
2. List REQUIRED fixes (must add before submit) — plain English labels, e.g. "Amount", "Business", "Approval path".
3. List SUGGESTIONS (nice to have) — attachments, clearer purpose, approver order, etc.
4. Ask ONE clarifying question only if something important is ambiguous; otherwise question is null.
5. Set ready=true ONLY when every critical field for the category is present, the approval path has at least one approver, and nothing in "required" remains. If anything is missing or unclear, ready must be false.

Respond with ONLY valid JSON:
{
  "ready": boolean,
  "required": ["string", ...],
  "suggestions": ["string", ...],
  "question": "string or null",
  "proposed": null
}`;
}

export async function validateApproval({ draft, requester, allUsers, allProjects = [] }) {
  const apiKey = cleanEnv(process.env.GROQ_API_KEY);
  if (!apiKey) throw new Error('GROQ_API_KEY not configured');

  const systemPrompt = buildValidatePrompt({ requester, allUsers, allProjects });
  const userContent = `Review this draft:\n${JSON.stringify(draft, null, 2)}`;

  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: TEXT_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      max_tokens: 1200,
      temperature: 0.2,
      response_format: { type: 'json_object' },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data?.error?.message || data?.error || JSON.stringify(data);
    throw new Error(`Groq returned ${res.status}: ${detail}`);
  }
  const raw = data.choices?.[0]?.message?.content || '';
  const clean = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(clean);
  } catch {
    parsed = { ready: false, required: [], suggestions: [clean], question: null, proposed: null };
  }
  if (!Array.isArray(parsed.required)) parsed.required = [];
  if (!Array.isArray(parsed.suggestions)) parsed.suggestions = [];
  return parsed;
}
