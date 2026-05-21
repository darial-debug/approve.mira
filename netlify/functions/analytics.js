import { json, requireAuth, readData } from './_lib.js';

// /api/analytics — admin/c_level only.
// Returns: per-approver avg/median time-to-decide, per-category counts, status breakdown.
export default async (req) => {
  try {
    const me = await requireAuth(req);
    if (me.role !== 'admin' && me.role !== 'c_level') {
      return json(403, { error: 'Admins / C-level only' });
    }

    const tasks = await readData('tasks', []);
    const users = await readData('users', []);
    const audit = await readData('audit_log', []);
    const userById = new Map(users.map((u) => [u.id, u]));

    // ── Per-approver decision times ──
    const perApprover = new Map(); // approverId → number[]
    for (const t of tasks) {
      const taskStart = t.createdAt;
      let prevDecisionAt = taskStart;
      for (const s of t.steps) {
        if (s.actedAt && (s.status === 'approved' || s.status === 'declined' || s.status === 'sent_back')) {
          const ms = new Date(s.actedAt) - new Date(prevDecisionAt);
          if (ms >= 0) {
            const arr = perApprover.get(s.approverId) || [];
            arr.push(ms);
            perApprover.set(s.approverId, arr);
          }
          prevDecisionAt = s.actedAt;
        }
      }
    }
    function median(arr) {
      if (!arr.length) return 0;
      const sorted = [...arr].sort((a, b) => a - b);
      const m = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[m] : Math.round((sorted[m - 1] + sorted[m]) / 2);
    }
    const approverStats = [...perApprover.entries()].map(([id, times]) => {
      const u = userById.get(id);
      return {
        approverId: id,
        name: u?.name || 'Unknown',
        role: u?.role || '',
        decisions: times.length,
        avgMs: Math.round(times.reduce((a, b) => a + b, 0) / times.length),
        medianMs: median(times),
      };
    }).sort((a, b) => b.decisions - a.decisions);

    // ── Status & category breakdown ──
    const status = { under_review: 0, approved: 0, declined: 0 };
    const byCategory = { payments: 0, content: 0, other: 0 };
    let totalApprovedMs = 0;
    let approvedCount = 0;
    for (const t of tasks) {
      status[t.status] = (status[t.status] || 0) + 1;
      byCategory[t.category] = (byCategory[t.category] || 0) + 1;
      if (t.status === 'approved') {
        const last = [...t.steps].reverse().find((s) => s.actedAt);
        if (last) {
          totalApprovedMs += new Date(last.actedAt) - new Date(t.createdAt);
          approvedCount++;
        }
      }
    }
    const avgTimeToApprovalMs = approvedCount ? Math.round(totalApprovedMs / approvedCount) : 0;

    // ── Pending bottlenecks (who's currently holding things up) ──
    const now = Date.now();
    const pending = [];
    for (const t of tasks) {
      if (t.status !== 'under_review') continue;
      const step = t.steps.find((s) => s.status === 'pending');
      if (!step) continue;
      pending.push({
        taskId: t.id,
        title: t.title,
        category: t.category,
        approverId: step.approverId,
        approverName: userById.get(step.approverId)?.name || 'Unknown',
        waitingMs: now - new Date(t.updatedAt || t.createdAt).getTime(),
        stepNumber: step.stepNumber,
        totalSteps: t.steps.length,
      });
    }
    pending.sort((a, b) => b.waitingMs - a.waitingMs);

    return json(200, {
      totals: { tasks: tasks.length, ...status },
      byCategory,
      avgTimeToApprovalMs,
      approverStats,
      pending: pending.slice(0, 50),
      auditCount: audit.length,
    });
  } catch (e) {
    if (e instanceof Response) return e;
    return json(500, { error: e.message });
  }
};

export const config = { path: '/api/analytics' };
