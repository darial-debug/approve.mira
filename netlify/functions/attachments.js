import { getStore } from '@netlify/blobs';
import { json, requireAuth, readData, writeData, newId } from './_lib.js';

const MAX_BYTES = 100 * 1024 * 1024; // 100 MB per file
const MAX_FILES_PER_TASK = 20;

function attachmentStore() {
  return getStore({ name: 'attachments', consistency: 'strong' });
}
function chunkStore() {
  return getStore({ name: 'attachment_chunks', consistency: 'strong' });
}

function canSeeTask(task, user) {
  if (user.role === 'admin' || user.role === 'c_level') return true;
  if (task.submitterId === user.id) return true;
  if (Array.isArray(task.steps) && task.steps.some((s) => s.approverId === user.id)) return true;
  return false;
}

export default async (req) => {
  try {
    const me = await requireAuth(req);
    const url = new URL(req.url);

    if (req.method === 'POST') {
      const body = await req.json();

      if (body.action === 'chunk') {
        const { uploadId, chunkIndex, base64 } = body;
        if (!uploadId || typeof chunkIndex !== 'number' || !base64) {
          return json(400, { error: 'uploadId, chunkIndex, base64 required' });
        }
        const buffer = Buffer.from(base64, 'base64');
        await chunkStore().set(`${uploadId}_${chunkIndex}`, buffer);
        return json(200, { ok: true, chunkIndex });
      }

      if (body.action === 'finalize') {
        const { uploadId, totalChunks, name, mimeType, taskId, size } = body;
        if (!uploadId || !totalChunks) return json(400, { error: 'uploadId, totalChunks required' });

        const parts = [];
        let totalSize = 0;
        for (let i = 0; i < totalChunks; i++) {
          const data = await chunkStore().get(`${uploadId}_${i}`, { type: 'arrayBuffer' });
          if (!data) return json(400, { error: `Missing chunk ${i}` });
          const buf = Buffer.from(data);
          parts.push(buf);
          totalSize += buf.length;
          if (totalSize > MAX_BYTES) {
            for (let j = 0; j < totalChunks; j++) { try { await chunkStore().delete(`${uploadId}_${j}`); } catch {} }
            return json(413, { error: `File too large (max ${Math.round(MAX_BYTES / 1024 / 1024)} MB)` });
          }
        }
        const fullBuffer = Buffer.concat(parts);

        const id = newId('a');
        const meta = {
          name: (name || 'file').slice(0, 200),
          mimeType: mimeType || 'application/octet-stream',
          size: size || fullBuffer.length,
          uploadedBy: me.id,
          uploadedByName: me.name,
          uploadedAt: new Date().toISOString(),
        };
        await attachmentStore().set(id, fullBuffer, { metadata: meta });

        for (let i = 0; i < totalChunks; i++) {
          try { await chunkStore().delete(`${uploadId}_${i}`); } catch {}
        }

        const attachment = { id, ...meta };

        if (taskId) {
          const tasks = await readData('tasks', []);
          const task = tasks.find((t) => t.id === taskId);
          if (task) {
            if (!canSeeTask(task, me)) return json(403, { error: 'Forbidden' });
            if (!Array.isArray(task.attachments)) task.attachments = [];
            if (task.attachments.length >= MAX_FILES_PER_TASK) {
              return json(413, { error: `Max ${MAX_FILES_PER_TASK} files per task` });
            }
            task.attachments.push(attachment);
            task.updatedAt = new Date().toISOString();
            await writeData('tasks', tasks);
          }
        }

        return json(200, { attachment });
      }

      return json(400, { error: 'Unknown action — use chunk or finalize' });
    }

    if (req.method === 'GET') {
      const id = url.searchParams.get('id');
      if (!id) return json(400, { error: 'id required' });
      const data = await attachmentStore().get(id, { type: 'arrayBuffer' });
      if (!data) return json(404, { error: 'Not found' });
      const metaResult = await attachmentStore().getMetadata(id).catch(() => null);
      const meta = metaResult?.metadata || {};
      const headers = {
        'Content-Type': meta.mimeType || 'application/octet-stream',
        'Content-Disposition': `inline; filename="${(meta.name || 'file').replace(/"/g, '')}"`,
        'Cache-Control': 'private, max-age=3600',
      };
      return new Response(Buffer.from(data), { status: 200, headers });
    }

    if (req.method === 'DELETE') {
      const id = url.searchParams.get('id');
      const taskId = url.searchParams.get('taskId');
      if (!id) return json(400, { error: 'id required' });
      if (taskId) {
        const tasks = await readData('tasks', []);
        const task = tasks.find((t) => t.id === taskId);
        if (!task) return json(404, { error: 'Task not found' });
        const attach = (task.attachments || []).find((a) => a.id === id);
        if (!attach) return json(404, { error: 'Attachment not found' });
        const canDelete = me.role === 'admin' || attach.uploadedBy === me.id || task.submitterId === me.id;
        if (!canDelete) return json(403, { error: 'Forbidden' });
        task.attachments = task.attachments.filter((a) => a.id !== id);
        task.updatedAt = new Date().toISOString();
        await writeData('tasks', tasks);
      }
      try { await attachmentStore().delete(id); } catch {}
      return json(200, { ok: true });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (e) {
    if (e instanceof Response) return e;
    return json(500, { error: e.message });
  }
};

export const config = { path: '/api/attachments' };
