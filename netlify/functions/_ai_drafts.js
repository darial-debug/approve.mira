import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();

function buildSystemPrompt({ requester, allUsers, source = 'app' }) {
  const teamList = allUsers
    .filter((u) => u.id !== requester.id)
    .map((u) => `- ${u.name} (${u.role})`)
    .join('\n');

  const sourceLine = source === 'slack'
    ? 'This came from a Slack message that the user forwarded — they want to capture it as an approval request quickly.'
    : '';

  return `You help users at Mira Creative draft approval requests in approve.mira.

Today is ${new Date().toISOString().split('T')[0]}.
The user creating this request: ${requester.name} (${requester.role}).
${sourceLine}

TEAM (use exact names when suggesting approvers):
${teamList || '(no other users yet)'}

Categories:
- "payments" — money out: invoices, vendor payments, refunds, reimbursements. Always needs amount + currency.
- "content" — content/marketing pieces that need sign-off (blog posts, social, ad copy, video edits).
- "other" — everything else.

Your job:
1. Read the user's description (may include images).
2. If something critical is missing, ask ONE concise clarifying question — only if it really matters. For payments: amount and currency are usually critical. For content: a link or summary is usually critical. Skip the question if you can reasonably infer.
3. Once you have enough, draft ONE approval request with:
   - title: concise, action-oriented
   - category: payments | content | other
   - fields (depends on category — see schemas below)
   - suggestedApproverNames: ordered list of approvers from the team (e.g. ["Dasha", "Timur"]). 2–3 max usually. Order matters: who acts first → who acts last. If unsure, suggest just the requester's manager or leave empty.

Field schemas:
- payments: { amount: number, currency: "AED"|"USD"|"EUR"|"GBP", vendor: string, purpose: string, dueDate: "YYYY-MM-DD"|null, description: string }
- content: { link: string, description: string }
- other: { description: string }

Always respond with ONLY JSON (no markdown, no preamble).
When asking a clarifying question:
{ "needsMoreInfo": true, "question": "one specific friendly question", "proposed": null }
When ready:
{
  "needsMoreInfo": false,
  "question": null,
  "proposed": {
    "title": "...",
    "category": "payments|content|other",
    "fields": { ... },
    "suggestedApproverNames": ["Name1", "Name2"]
  }
}`;
}

export async function draftApproval({ messages, images = [], requester, allUsers, source = 'app' }) {
  const systemPrompt = buildSystemPrompt({ requester, allUsers, source });

  const claudeMessages = messages.map((m) => ({ role: m.role, content: m.content }));

  // Splice images into the latest user turn if passed separately.
  if (images.length && claudeMessages.length) {
    const lastIdx = claudeMessages.length - 1;
    if (claudeMessages[lastIdx].role === 'user') {
      const existing = claudeMessages[lastIdx].content;
      const textPart = typeof existing === 'string'
        ? existing
        : (Array.isArray(existing) ? existing.find((b) => b.type === 'text')?.text || '' : '');
      const blocks = [];
      images.forEach((img) => {
        blocks.push({
          type: 'image',
          source: { type: 'base64', media_type: img.mediaType || 'image/jpeg', data: img.base64 },
        });
      });
      blocks.push({ type: 'text', text: textPart || 'Draft an approval from these.' });
      claudeMessages[lastIdx].content = blocks;
    }
  }

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1500,
    system: systemPrompt,
    messages: claudeMessages,
  });

  const textBlock = response.content.find((c) => c.type === 'text');
  if (!textBlock) throw new Error('No text in AI response');
  let clean = textBlock.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(clean);
  } catch {
    parsed = { needsMoreInfo: true, question: clean, proposed: null };
  }

  // Map suggested approver names → ids so the UI can pre-fill the path picker.
  if (parsed.proposed && Array.isArray(parsed.proposed.suggestedApproverNames)) {
    parsed.proposed.suggestedApproverIds = parsed.proposed.suggestedApproverNames
      .map((name) => {
        const u = allUsers.find((x) => x.name.toLowerCase() === name.toLowerCase());
        return u?.id;
      })
      .filter(Boolean);
  }

  return parsed;
}
