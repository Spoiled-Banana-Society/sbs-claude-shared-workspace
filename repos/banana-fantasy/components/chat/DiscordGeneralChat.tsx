'use client';

/**
 * Discord-backed #general chat (prototype).
 *
 * Embeds a Discord channel via Widgetbot.io's React component. Users sign in
 * with their Discord account inside the embed; messages they send post to
 * the real Discord channel as themselves, and messages in that channel
 * appear here. Identity is Discord, not wallet.
 *
 * To point this at the SBS Discord server:
 *   1. Invite the Widgetbot bot to your server: https://widgetbot.io/invite
 *   2. Get the server ID (right-click server icon → Copy Server ID, with
 *      Developer Mode enabled in Discord settings).
 *   3. Get the #general channel ID (right-click channel → Copy Channel ID).
 *   4. Replace SERVER_ID / CHANNEL_ID below.
 *
 * Currently using Widgetbot's own demo server (Widgetbot Lounge) so the
 * prototype is visually live without any configuration.
 */

import WidgetBot from '@widgetbot/react-embed';

const SERVER_ID = '299881420891881473';
const CHANNEL_ID = '355719584830980096';

export function DiscordGeneralChat() {
  return (
    <div className="w-full h-full">
      <WidgetBot
        server={SERVER_ID}
        channel={CHANNEL_ID}
        width="100%"
        height="100%"
        style={{ border: 'none', display: 'block' }}
      />
    </div>
  );
}
