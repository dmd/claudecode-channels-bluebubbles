#!/usr/bin/env bun
/**
 * BlueBubbles (iMessage) channel for Claude Code.
 *
 * Sends replies via the BlueBubbles REST API.
 * Polls for new inbound messages every 5 seconds.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'

// ── Config ──────────────────────────────────────────────────────────────────

// Load .env from the same directory as this script
const SCRIPT_DIR = dirname(new URL(import.meta.url).pathname)
try {
  for (const line of readFileSync(join(SCRIPT_DIR, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^(\w+)=(.*)$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
  }
} catch {}

const BB_PASS = process.env.BLUEBUBBLE_PASS
const BB_HOST = process.env.BLUEBUBBLE_HOST ?? 'localhost'
const BB_PORT = process.env.BLUEBUBBLE_PORT ?? '1234'
const BB_CONVERSATION = process.env.BLUEBUBBLE_CONVERSATION

if (!BB_PASS) {
  process.stderr.write('bluebubbles channel: BLUEBUBBLE_PASS required in .env\n')
  process.exit(1)
}
if (!BB_CONVERSATION) {
  process.stderr.write('bluebubbles channel: BLUEBUBBLE_CONVERSATION required in .env\n')
  process.exit(1)
}

const BASE_URL = `http://${BB_HOST}:${BB_PORT}/api/v1`
const CHAT_GUID = `iMessage;-;+${BB_CONVERSATION}`
const POLL_INTERVAL_MS = 5_000

// ── BlueBubbles API helpers ─────────────────────────────────────────────────

async function bbFetch(path: string, opts?: RequestInit): Promise<any> {
  const sep = path.includes('?') ? '&' : '?'
  const url = `${BASE_URL}${path}${sep}password=${BB_PASS}`
  const res = await fetch(url, opts)
  if (!res.ok) throw new Error(`BlueBubbles ${path}: ${res.status} ${await res.text()}`)
  return res.json()
}

async function sendMessage(text: string): Promise<string> {
  const tempGuid = `temp-${crypto.randomUUID()}`
  const body = JSON.stringify({ chatGuid: CHAT_GUID, tempGuid, message: text })
  const data = await bbFetch('/message/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
  return data.data?.guid ?? tempGuid
}

// ── MCP Server ──────────────────────────────────────────────────────────────

const mcp = new Server(
  { name: 'bluebubbles', version: '0.0.1' },
  {
    capabilities: {
      experimental: { 'claude/channel': {} },
      tools: {},
    },
    instructions:
      `The sender reads iMessage, not this session. Anything you want them to see must go through the reply tool — your transcript output never reaches their chat.\n\n` +
      `Messages from iMessage arrive as <channel source="bluebubbles" chat_id="${CHAT_GUID}" message_id="..." user="...">. ` +
      `Reply with the reply tool. Pass chat_id back. Use reply_to (set to a message_id) only when replying to an earlier message; the latest message doesn't need a quote-reply, omit reply_to for normal responses.`,
  },
)

// ── Tools ───────────────────────────────────────────────────────────────────

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'reply',
      description: 'Send a message to the iMessage conversation via BlueBubbles.',
      inputSchema: {
        type: 'object',
        properties: {
          chat_id: { type: 'string', description: 'The chat GUID to reply in' },
          text: { type: 'string', description: 'The message text to send' },
        },
        required: ['chat_id', 'text'],
      },
    },
  ],
}))

mcp.setRequestHandler(CallToolRequestSchema, async req => {
  const args = (req.params.arguments ?? {}) as Record<string, unknown>
  try {
    switch (req.params.name) {
      case 'reply': {
        const text = args.text as string
        if (!text?.trim()) return { content: [{ type: 'text', text: 'empty message, not sent' }] }
        const guid = await sendMessage(text)
        return { content: [{ type: 'text', text: `sent (${guid})` }] }
      }
      default:
        return { content: [{ type: 'text', text: `unknown tool: ${req.params.name}` }], isError: true }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { content: [{ type: 'text', text: `reply failed: ${msg}` }], isError: true }
  }
})

// ── Connect ─────────────────────────────────────────────────────────────────

await mcp.connect(new StdioServerTransport())

// ── Polling for inbound messages ────────────────────────────────────────────

// Track the timestamp of the last message we've seen so we only deliver new ones.
// Seed with "now" so we don't replay history on startup.
let lastSeenTs = Date.now()

async function pollOnce(): Promise<void> {
  try {
    // Fetch recent messages from the specific chat, sorted ascending
    const data = await bbFetch(
      `/chat/${encodeURIComponent(CHAT_GUID)}/message?limit=10&sort=ASC&after=${lastSeenTs}`
    )
    const messages: any[] = data.data ?? []
    for (const msg of messages) {
      // Skip our own outbound messages
      if (msg.isFromMe) {
        // Still advance the timestamp so we don't re-fetch these
        if (msg.dateCreated > lastSeenTs) lastSeenTs = msg.dateCreated
        continue
      }
      // Skip non-text messages (reactions, group events, etc.)
      if (!msg.text?.trim()) {
        if (msg.dateCreated > lastSeenTs) lastSeenTs = msg.dateCreated
        continue
      }

      const sender = msg.handle?.address ?? 'unknown'
      await mcp.notification({
        method: 'notifications/claude/channel',
        params: {
          content: msg.text,
          meta: {
            chat_id: CHAT_GUID,
            message_id: msg.guid ?? '',
            user: sender,
            ts: new Date(msg.dateCreated).toISOString(),
          },
        },
      })

      if (msg.dateCreated > lastSeenTs) lastSeenTs = msg.dateCreated
    }
  } catch (err) {
    process.stderr.write(`bluebubbles poll error: ${err instanceof Error ? err.message : err}\n`)
  }
}

// Start the poll loop
setInterval(pollOnce, POLL_INTERVAL_MS)

process.stderr.write(`bluebubbles channel: connected to ${BASE_URL}, chat=${CHAT_GUID}\n`)
