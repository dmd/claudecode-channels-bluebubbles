# BlueBubbles Channel for Claude Code

An iMessage channel plugin for [Claude Code](https://code.claude.com/) using [BlueBubbles](https://bluebubbles.app/) as the bridge. Send and receive iMessages from a running Claude Code session.

## Prerequisites

- [Claude Code](https://code.claude.com/docs/en/quickstart) v2.1.80+
- [Bun](https://bun.sh)
- [BlueBubbles Server](https://bluebubbles.app/) running on a Mac with iMessage

## Setup

1. Clone this repo:

   ```bash
   git clone https://github.com/dmd/claudecode-channels-bluebubbles.git
   cd claudecode-channels-bluebubbles
   ```

2. Create a `.env` file with your BlueBubbles credentials:

   ```
   BLUEBUBBLE_PASS=your-server-password
   BLUEBUBBLE_HOST=localhost
   BLUEBUBBLE_PORT=1234
   BLUEBUBBLE_CONVERSATION=15551234567
   ```

   `BLUEBUBBLE_CONVERSATION` is the phone number (digits only, including country code) of the iMessage conversation you want to bridge. The plugin constructs the chat GUID as `iMessage;-;+{number}`.

3. Register the MCP server in your `~/.claude.json` under the top-level `mcpServers` key:

   ```json
   {
     "mcpServers": {
       "bluebubbles": {
         "command": "bun",
         "args": ["/absolute/path/to/claudecode-channels-bluebubbles/server.ts"]
       }
     }
   }
   ```

4. Start Claude Code with the channel enabled:

   ```bash
   claude --dangerously-load-development-channels server:bluebubbles
   ```

## How it works

- The plugin registers as an MCP server with the `claude/channel` capability.
- It polls the BlueBubbles REST API every 5 seconds for new inbound messages and forwards them into your Claude Code session as `<channel>` events.
- Claude replies using the `reply` tool, which sends the message back through BlueBubbles as an iMessage.
- Deduplication is handled by tracking message GUIDs, so each message is delivered exactly once.

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `BLUEBUBBLE_PASS` | yes | | BlueBubbles server password |
| `BLUEBUBBLE_HOST` | no | `localhost` | BlueBubbles server host |
| `BLUEBUBBLE_PORT` | no | `1234` | BlueBubbles server port |
| `BLUEBUBBLE_CONVERSATION` | yes | | Phone number (digits only, with country code) |

## License

Apache-2.0
