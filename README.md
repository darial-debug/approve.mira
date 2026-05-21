# approve.mira

Multi-step approval app for Mira Creative. Submitters create a request (payments / content / other), build a per-task approval path, and each approver acts in order via the web app or directly from Slack.

Captures requests from Slack messages via a **"Send to approve.mira"** message shortcut, then completes the form in the web app. Notifies approvers across in-app, Slack DM, Telegram, and email.

Mirrors the architecture of `mira-tracker`: static SPA + Netlify Functions + Netlify Blobs (JSON document store) + bcrypt/JWT auth.

---

## Stack

- Frontend: vanilla HTML/JS SPA (`public/index.html`)
- Backend: Netlify Functions (`netlify/functions/`)
- Storage: Netlify Blobs (one blob per collection)
- Auth: email + 4–8 digit passcode, JWT sessions
- File uploads: chunked, 100 MB / 20 files per task
- Channels: in-app inbox, Slack DM, Telegram, email (Resend)

## Project layout

```
approve.mira/
├── netlify.toml
├── package.json
├── public/index.html               # SPA shell + all UI
└── netlify/functions/
    ├── _lib.js                     # storage + JWT + role guards
    ├── _notify.js                  # Slack / Telegram / email / inbox fan-out
    ├── login.js                    # /api/login (incl. first-setup)
    ├── me.js                       # /api/me
    ├── passcode.js                 # /api/passcode (change own)
    ├── notifications.js            # /api/notifications
    ├── users.js                    # /api/users[/:id] (admin CRUD)
    ├── departments.js              # /api/departments[/:id] (admin CRUD)
    ├── tasks.js                    # /api/tasks[/:id[/act|/resubmit]]
    ├── attachments.js              # /api/attachments (chunked)
    ├── analytics.js                # /api/analytics (admin/c_level)
    ├── slack-connect.js            # /api/slack-connect (link account)
    ├── slack-events.js             # /api/slack-events (DM CODE → link)
    ├── slack-interactions-background.js   # message shortcut + buttons
    ├── telegram-connect.js         # /api/telegram-connect
    ├── telegram-webhook.js         # /api/telegram-webhook
    ├── telegram-setup.js           # /api/telegram-setup (admin: register webhook)
    ├── task-drafts.js              # /api/task-drafts (Slack-captured drafts)
    └── status.js                   # /api/status
```

## Environment variables

Set these in Netlify → Site → Environment:

| Variable | Required | Purpose |
| --- | --- | --- |
| `JWT_SECRET` | yes | Random 32+ char string for signing session tokens |
| `APP_BASE_URL` | recommended | e.g. `https://approve.mira.netlify.app` — used in notification deep links |
| `SLACK_BOT_TOKEN` | for Slack | Bot User OAuth Token (`xoxb-…`) |
| `SLACK_SIGNING_SECRET` | for Slack | From your Slack app config |
| `TELEGRAM_BOT_TOKEN` | for Telegram | BotFather token |
| `TELEGRAM_BOT_USERNAME` | for Telegram | Bot username **without** `@` (lets the UI render one-click `t.me/<bot>?start=CODE` links) |
| `TELEGRAM_WEBHOOK_SECRET` | optional | Random string; if set, used to verify webhook calls |
| `RESEND_API_KEY` | for email | https://resend.com |
| `RESEND_FROM` | optional | Sender, e.g. `approve.mira <noreply@yourdomain.com>` |

## Setup

```bash
cd approve.mira
npm install
npx netlify dev
```

Visit `http://localhost:8888/#/?setup=1` → set up first admin (**must use** `daria.l@miracreative.ae`).

After first login, in the Admin tab:
1. Create departments.
2. Add users (each gets an initial passcode shown once).
3. From your profile, generate Slack/Telegram connect codes.

## Slack app configuration

In `https://api.slack.com/apps`:

1. **OAuth & Permissions** → scopes: `chat:write`, `im:write`, `im:history`, `users:read`, `users:read.email`, `reactions:write`.
2. **Event Subscriptions** → request URL `https://<your-site>/api/slack-events`, subscribe to bot event `message.im`.
3. **Interactivity & Shortcuts** → enable interactivity, request URL `https://<your-site>/api/slack-interactions`.
4. Under **Shortcuts**, add a **Message** shortcut: name **"Send to approve.mira"**, callback ID **`send_to_approve_mira`**.

## Telegram bot configuration

1. Talk to `@BotFather` → `/newbot` → grab token + username.
2. Set env vars `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, optionally `TELEGRAM_WEBHOOK_SECRET`.
3. Deploy, then POST `/api/telegram-setup` (admin only) with `{ "baseUrl": "https://<your-site>" }` to register the webhook with Telegram.

## Data model

All collections live as single JSON blobs in Netlify Blobs:

- `users` — `{ id, email, name, role, departmentId, passcodeHash, slackUserId?, telegramChatId? }`
- `departments` — `{ id, name, headUserId }`
- `tasks` — `{ id, title, category, fields, submitterId, status, steps[], attachments[], source, slackMessage?, createdAt, updatedAt }`
- `audit_log` — append-only entries per task
- `inbox` — `{ [userId]: notification[] }`
- `task_drafts` — `{ [userId]: draft[] }` (from Slack shortcut)
- `slack_codes`, `telegram_codes`, `slack_processed`

## Approval engine

- Each task has `steps[]`, each step has `stepNumber`, `approverId`, `status` (`pending|approved|declined|sent_back`), `actedAt`, `comment`.
- Submitter can edit title/fields **only while no step has been decided**.
- Submitter can edit the approval path **only before step 1 is decided**.
- Dept heads, C-level, and admin can edit the remaining path at any time.
- `decline` ends the task. Submitter can `resubmit` (resets all steps to pending).
- `send_back` reopens an earlier step (caller picks which one).

## Caveats / TODO

- Blob store is a single-document JSON write per collection — fine for a few hundred tasks per blob, but eventually swap to Netlify DB (Postgres) for analytics-heavy use.
- Category fields are intentionally minimal until you confirm the final schema; update `tasks.js → normalizeFields` and `index.html → renderCategoryFields/gatherCategoryFields` together.
- WhatsApp is stubbed in the profile UI; wire it up via Twilio/Meta when ready.
