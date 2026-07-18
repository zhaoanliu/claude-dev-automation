// Sentry → GitHub webhook bridge for the Sentry auto-fix pipeline
// (workflow-templates/sentry-auto-fix.yml).
//
// Placement: copy this file to app/api/sentry-webhook/route.ts in any
// Next.js App Router project. It is self-contained — no other imports needed.
//
// What it does: receives Sentry alert webhooks, verifies the HMAC signature,
// and relays alert triggers to GitHub as a `repository_dispatch` event with
// event_type `sentry-issue`, which the sentry-auto-fix workflow listens for.
//
// Required env vars (set on your deploy platform, e.g. Vercel):
//   GITHUB_REPO           — "owner/repo" the dispatch is sent to
//   GH_PAT                — GitHub PAT with repo scope
//   SENTRY_WEBHOOK_SECRET — Client Secret of the Sentry internal integration;
//                           if unset, signature verification is skipped
//
// See SETUP.md (next to this file) for the Sentry-side configuration.

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

interface SentryEvent {
  title?: string
  issue_url?: string
  culprit?: string
  web_url?: string
}

interface SentryPayload {
  action?: string
  data?: {
    event?: SentryEvent
  }
}

function getGitHubCreds(): { repo: string; pat: string } | null {
  const repo = process.env.GITHUB_REPO
  const pat = process.env.GH_PAT
  if (!repo || !pat) {
    console.error('Missing GITHUB_REPO or GH_PAT env vars')
    return null
  }
  return { repo, pat }
}

async function dispatchGitHubEvent(
  repo: string,
  pat: string,
  eventType: string,
  payload: Record<string, unknown>
): Promise<Response> {
  return fetch(`https://api.github.com/repos/${repo}/dispatches`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${pat}`,
    },
    body: JSON.stringify({ event_type: eventType, client_payload: payload }),
  })
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()

  const secret = process.env.SENTRY_WEBHOOK_SECRET
  if (secret) {
    const signature = req.headers.get('sentry-hook-signature')
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
    if (signature !== expected) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  }

  const payload: SentryPayload = JSON.parse(rawBody)

  // Only handle alert triggers, not other webhook events
  if (payload.action !== 'triggered') {
    return NextResponse.json({ ok: true })
  }

  const event = payload.data?.event
  if (!event) {
    return NextResponse.json({ ok: true })
  }

  const title = event.title ?? 'Sentry error'
  const sentryUrl = event.issue_url ?? event.web_url ?? ''
  const culprit = event.culprit ?? ''

  const creds = getGitHubCreds()
  if (!creds) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  const res = await dispatchGitHubEvent(creds.repo, creds.pat, 'sentry-issue', {
    title,
    sentry_url: sentryUrl,
    culprit,
  })

  if (!res.ok) {
    const text = await res.text()
    console.error('GitHub dispatch failed:', res.status, text)
    return NextResponse.json({ error: 'Failed to dispatch' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
