import {
  json, requireAuth, readData, writeData, newId, appendAudit,
  CATEGORIES, CURRENCIES, PATH_EDITORS,
} from './_lib.js';
import { notifyUser } from './_notify.js';

// ───────────────────────────── Helpers ─────────────────────────────

function normalizeFields(category, fields = {}) {
  const f = { ...fields };
  if (category === 'payments') {
    f.amount = f.amount != null ? Number(f.amount) : null;
    if (f.amount != null && !Number.isFinite(f.amount)) {
      throw json(400, { error: 'Amount must be a number' });
    }
    if (f.currency && !CURRENCIES.includes(f.currency)) {
      throw json(400, { error: `Currency must be one of ${CURRENCIES.join(', ')}` });
    }
  }
  return f;
}

function buildSteps(approverIds) {
  if (!Array.isArray(approverIds) || approverIds.length === 0) {
    throw json(400, { error: 'Approval path must have at least one approver' });
  }
  return approverIds.map((approverId, idx) => ({
    stepNumber: idx + 1,
    approverId,
    status: 'pending',
    actedAt: null,
    comment: null,
  }));
}

function currentStepIndex(task) {
  return task.steps.findIndex((s) => s.status === 'pending');
}

async function dispatchPendingStep(task, users, submitter) {
  const idx = currentStepIndex(task);
  if (idx === -1) return;
  const step = task.steps[idx];
  const approver = users.find((u) => u.id === step.approverId);
  if (!approver) return;
  await notifyUser(approver, {
    kind: 'approval_request',
    taskId: task.id,
    title: `Approval needed — ${task.title}`,
    body: `From ${submitter?.name || 'a teammate'} · category: ${task.category}${task.category === 'payments' && task.fields?.amount ? ` · ${task.fields.amount} ${task.fields.currency || ''}` : ''}\nYou're step ${step.stepNumber} of ${task.steps.length}.`,
    slackPayload: {
      taskId: task.id,
      taskTitle: task.title,
      submitterName: submitter?.name || 'A teammate',
      category: task.category,
    },
  });
}

// ───────────────────────────── Routes ─────────────────────────────

// GET    /api/tasks                  → list (filter by ?scope=mine|pending|submitted|all)
// POST   /api/tasks                  → create
// GET    /api/tasks/:id              → get one
// PATCH  /api/tasks/:id              → edit fields / change path (auth-gated)
// POST   /api/tasks/:id/act          → approve / decline / send-back current step
// POST   /api/tasks/:id/resubmit     → submitter resubmits after decline
export default async (req) => {
  try {
    const url = new URL(req.url);
    const segments = url.pathname.split('/').filter(Boolean); // ['api','tasks',...]
    const id = segments[2];
    const sub = segments[3];

    const me = await requireAuth(req);

    if (req.method === 'GET' && !id) {
      const scope = url.searchParams.get('scope') || 'mine';
      const tasks = await readData('tasks', []);
      let list = tasks;
      if (scope === 'submitted') list = tasks.filter((t) => t.submitterId === me.id);
      else if (scope === 'pending') {
        list = tasks.filter((t) => {
          if (t.status !== 'under_review') return false;
          const step = t.steps.find((s) => s.status === 'pending');
          return step && step.approverId === me.id;
        });
      } else if (scope === 'mine') {
        list = tasks.filter((t) => {
          if (t.submitterId === me.id) return true;
          return t.steps.some((s) => s.approverId === me.id);
        });
      } else if (scope === 'all') {
        if (me.role !== 'admin' && me.role !== 'c_level') {
          return json(403, { error: 'Admins/C-level only for scope=all' });
        }
      }
      list = list.sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt));
      return json(200, { tasks: list });
    }

    if (req.method === 'POST' && !id) {
      const body = await req.json();
      const title = (body.title || '').trim();
      const category = body.category;
      if (!title) return json(400, { error: 'Title required' });
      if (!CATEGORIES.includes(category)) return json(400, { error: `Category must be one of ${CATEGORIES.join(', ')}` });

      const fields = normalizeFields(category, body.fields || {});
      const steps = buildSteps(body.approverIds || []);

      const now = new Date().toISOString();
      const task = {
        id: newId('t'),
        title,
        category,
        fields,
        submitterId: me.id,
        status: 'under_review',
        steps,
        attachments: Array.isArray(body.attachments) ? body.attachments : [],
        source: body.source || 'web', // 'web' | 'slack'
        slackMessage: body.slackMessage || null, // { channel, ts, permalink, text }
        createdAt: now,
        updatedAt: now,
      };

      const tasks = await readData('tasks', []);
      tasks.push(task);
      await writeData('tasks', tasks);

      await appendAudit(task.id, { action: 'created', userId: me.id });
      const users = await readData('users', []);
      await dispatchPendingStep(task, users, me);

      return json(200, { task });
    }

    if (req.method === 'GET' && id && !sub) {
      const tasks = await readData('tasks', []);
      const t = tasks.find((x) => x.id === id);
      if (!t) return json(404, { error: 'Task not found' });
      const audit = (await readData('audit_log', [])).filter((a) => a.taskId === id);
      return json(200, { task: t, audit });
    }

    if (req.method === 'PATCH' && id && !sub) {
      const body = await req.json();
      const tasks = await readData('tasks', []);
      const t = tasks.find((x) => x.id === id);
      if (!t) return json(404, { error: 'Task not found' });

      // Path edits — allowed for submitter while still on step 1 pending, plus dept_head/c_level/admin anytime.
      if (body.approverIds !== undefined) {
        const isPathEditor = PATH_EDITORS.has(me.role);
        const isSubmitterEarly = me.id === t.submitterId
          && t.status === 'under_review'
          && t.steps.findIndex((s) => s.status !== 'pending') === -1;
        if (!isPathEditor && !isSubmitterEarly) {
          return json(403, { error: 'You cannot change the approval path on this task.' });
        }
        // Preserve already-completed steps; only replace the pending tail.
        const completed = t.steps.filter((s) => s.status !== 'pending');
        const newTail = buildSteps(body.approverIds).map((s, i) => ({
          ...s,
          stepNumber: completed.length + i + 1,
        }));
        t.steps = [...completed, ...newTail];
        await appendAudit(t.id, { action: 'path_changed', userId: me.id, meta: { approverIds: body.approverIds } });
      }

      // Field/title edits — only submitter, only while no decisions yet.
      const anyDecided = t.steps.some((s) => s.status !== 'pending');
      if ((body.title !== undefined || body.fields !== undefined) && (me.id !== t.submitterId || anyDecided)) {
        return json(403, { error: 'Only the submitter can edit, and only before any approver acts.' });
      }
      if (body.title !== undefined) t.title = String(body.title).trim();
      if (body.fields !== undefined) t.fields = normalizeFields(t.category, body.fields);
      if (body.attachments !== undefined) t.attachments = body.attachments;

      t.updatedAt = new Date().toISOString();
      await writeData('tasks', tasks);

      // If the next pending approver changed because of a path edit, notify them.
      if (body.approverIds !== undefined && t.status === 'under_review') {
        const users = await readData('users', []);
        const submitter = users.find((u) => u.id === t.submitterId);
        await dispatchPendingStep(t, users, submitter);
      }
      return json(200, { task: t });
    }

    if (req.method === 'POST' && id && sub === 'act') {
      const body = await req.json();
      const action = body.action; // 'approve' | 'decline' | 'send_back'
      const comment = (body.comment || '').trim();
      const sendBackTo = body.stepNumber; // for send_back, target step number

      const tasks = await readData('tasks', []);
      const t = tasks.find((x) => x.id === id);
      if (!t) return json(404, { error: 'Task not found' });
      if (t.status !== 'under_review') return json(409, { error: 'Task is not awaiting approval.' });

      const idx = currentStepIndex(t);
      if (idx === -1) return json(409, { error: 'No pending step.' });
      const step = t.steps[idx];
      if (step.approverId !== me.id) return json(403, { error: 'Not your step.' });

      const now = new Date().toISOString();

      if (action === 'approve') {
        step.status = 'approved';
        step.actedAt = now;
        step.comment = comment || null;
        const nextIdx = currentStepIndex(t);
        if (nextIdx === -1) {
          t.status = 'approved';
        }
        await appendAudit(t.id, { action: 'approved_step', userId: me.id, meta: { stepNumber: step.stepNumber, comment } });
      } else if (action === 'decline') {
        step.status = 'declined';
        step.actedAt = now;
        step.comment = comment || null;
        t.status = 'declined';
        await appendAudit(t.id, { action: 'declined', userId: me.id, meta: { stepNumber: step.stepNumber, comment } });
      } else if (action === 'send_back') {
        // Send back to step `sendBackTo` (1-indexed). Earlier completed steps become pending again.
        const target = Number(sendBackTo);
        if (!Number.isInteger(target) || target < 1 || target > step.stepNumber) {
          return json(400, { error: 'send_back stepNumber must be between 1 and current step.' });
        }
        step.status = 'sent_back';
        step.actedAt = now;
        step.comment = comment || null;
        for (const s of t.steps) {
          if (s.stepNumber >= target && s.stepNumber < step.stepNumber) {
            s.status = 'pending';
            s.actedAt = null;
            s.comment = null;
          }
        }
        // Re-open the target step.
        t.steps[target - 1].status = 'pending';
        await appendAudit(t.id, { action: 'sent_back', userId: me.id, meta: { fromStep: step.stepNumber, toStep: target, comment } });
      } else {
        return json(400, { error: 'Unknown action' });
      }

      t.updatedAt = now;
      await writeData('tasks', tasks);

      // Notify submitter + next approver as appropriate.
      const users = await readData('users', []);
      const submitter = users.find((u) => u.id === t.submitterId);

      if (t.status === 'approved') {
        await notifyUser(submitter, {
          kind: 'decision',
          taskId: t.id,
          title: `Approved — ${t.title}`,
          body: `Your request was approved by all ${t.steps.length} approver(s).`,
        });
      } else if (t.status === 'declined') {
        await notifyUser(submitter, {
          kind: 'decision',
          taskId: t.id,
          title: `Declined — ${t.title}`,
          body: `${me.name} declined at step ${step.stepNumber}.${comment ? `\nReason: ${comment}` : ''}`,
        });
      } else {
        // Either advanced to next step or was sent back — dispatch to whoever is now pending.
        await dispatchPendingStep(t, users, submitter);
        if (action === 'send_back') {
          await notifyUser(submitter, {
            kind: 'sent_back',
            taskId: t.id,
            title: `Sent back — ${t.title}`,
            body: `${me.name} sent this back to step ${sendBackTo}.${comment ? `\nNote: ${comment}` : ''}`,
          });
        }
      }
      return json(200, { task: t });
    }

    if (req.method === 'POST' && id && sub === 'resubmit') {
      const tasks = await readData('tasks', []);
      const t = tasks.find((x) => x.id === id);
      if (!t) return json(404, { error: 'Task not found' });
      if (t.submitterId !== me.id) return json(403, { error: 'Only the submitter can resubmit.' });
      if (t.status !== 'declined') return json(409, { error: 'Only declined tasks can be resubmitted.' });

      // Reset all steps to pending and clear status.
      t.steps = t.steps.map((s) => ({ ...s, status: 'pending', actedAt: null, comment: null }));
      t.status = 'under_review';
      t.updatedAt = new Date().toISOString();
      await writeData('tasks', tasks);
      await appendAudit(t.id, { action: 'resubmitted', userId: me.id });
      const users = await readData('users', []);
      await dispatchPendingStep(t, users, me);
      return json(200, { task: t });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (e) {
    if (e instanceof Response) return e;
    return json(500, { error: e.message });
  }
};

export const config = { path: '/api/tasks/*' };
