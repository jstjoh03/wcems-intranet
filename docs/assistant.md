# Ask WCEMS — the intranet's AI assistant

"Ask WCEMS" is the floating chat button on every signed-in page. It answers
"how do I…" questions about the intranet itself — scheduling, training,
policies, equipment, and the rest — with deep links into the app. It is
**not** medical direction and it refuses to answer clinical questions from
memory; it points to [/protocols](../src/views/protocols) and the in-app
tools instead.

## How it works

```
AssistantPanel.vue ──POST──▶ ask-assistant (edge function) ──▶ Claude API
        ▲                          │
        │   SSE text deltas        │ logs every exchange
        └──────────────────────────┴──▶ assistant_messages (tokens + cost)
```

- **Model**: `claude-sonnet-5-5`, set as the `MODEL` constant at the top of
  [`supabase/functions/ask-assistant/index.ts`](../supabase/functions/ask-assistant/index.ts).
  Switching to `claude-haiku-5-5` is a one-line change.
- **No retrieval.** The whole knowledge base is concatenated into the system
  prompt with Anthropic prompt caching (`cache_control: ephemeral`). The
  cached block is byte-stable per role variant, so repeat questions cost
  cents. Keep it that way: never put timestamps, user names, or any
  per-request text inside the KB or the rules block. (Today's date rides in
  a second, uncached system block.)
- **Two prompt variants**: crew sees articles with `audience: all`;
  admins/supervisors also get the `audience: admin` articles. A crew user
  asking an admin question gets "that's an admin feature — contact …", not
  instructions.
- **Rate limit**: 40 questions per person per day (Central time), enforced
  server-side by counting `assistant_messages` rows.
- **Guard rails** live in the `RULES` string in the function: KB-only
  answers, mandatory deep links, no door codes/credentials, no medical
  guidance, no HR counseling.

## The knowledge base

Articles are markdown files in
[`supabase/functions/ask-assistant/kb/`](../supabase/functions/ask-assistant/kb/),
organized by area (`getting-around/`, `schedule/`, `training/`, `admin/`, …).
Each file starts with front-matter:

```markdown
---
title: Requesting time off
audience: all        # all | admin
route: /schedule
---

Body in plain markdown. 150–400 words. Write ONLY what the app really
does — verify routes, button labels, and behavior against the source
before writing. Include the deep link path(s) the assistant should cite.
```

### Adding or editing an article

1. Add/edit the `.md` file under `kb/`.
2. If it's a **new** file, add its path to the `KB_FILES` manifest near the
   top of `index.ts` (the fixed order keeps the prompt cache stable).
3. Regenerate the baked KB module — the deployed bundle can't read files at
   runtime, so the markdown is compiled into `kb-content.ts`:

   ```bash
   node scripts/build-assistant-kb.mjs
   ```

4. Redeploy the function — **that's what ships KB changes**:

   ```bash
   npx supabase functions deploy ask-assistant
   ```

   No frontend build or migration needed for KB-only edits. Never edit
   `kb-content.ts` by hand — it's generated.

### Writing guidelines

- Document the app as it is, never as planned. If a feature changes,
  update its article in the same PR.
- Lead with the user's goal, then numbered steps with the real button
  labels, then the deep link.
- `audience: admin` for anything crews can't do; the crew variant never
  sees those files.
- Never put door codes, fuel numbers, or credentials in an article — only
  where the app reveals them.

## Unanswered questions → feature requests

When the KB can't answer, the model appends a `[[OFFER_REQUEST]]` marker.
The panel strips it and shows a "send it to the dev team" card; sending
inserts into `assistant_feature_requests` (plain RLS insert, 5/day/user).
There's also a quiet "Suggest a feature" link in the panel footer.

## Admin visibility

`/admin/assistant` (admin-gated) has two tabs:

- **Questions** — month-to-date question count + estimated spend, and the
  recent exchange log with per-exchange token counts and cost
  (from `assistant_messages`, which only the edge function writes).
- **Requests** — the feature-request inbox: triage each row with
  kind / status / admin note.

## Secrets & deploy

- `ANTHROPIC_API_KEY` is the function's only non-platform secret:

  ```bash
  npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
  ```

- Deploy **with JWT verification on** (users call it with their session
  token): `npx supabase functions deploy ask-assistant` — do **not** pass
  `--no-verify-jwt`. If deploying through the Supabase MCP tool, pass
  `verify_jwt: true` with two files: `index.ts` and the generated
  `kb-content.ts` (the raw `kb/*.md` files don't need to ship — they're
  baked in).
- Costs are logged per exchange; a belt-and-braces monthly spend limit can
  be set at console.anthropic.com.

## Later phases (not built)

- Phase 2: policy/protocol PDF text ingestion with citations.
- Phase 3: live personal data via tool use ("what's my leave balance?").

The Phase-1 code keeps both doors open: the KB loader is isolated, and the
edge function already resolves the caller's `app_users` row, which is what
tool-use handlers would need.
