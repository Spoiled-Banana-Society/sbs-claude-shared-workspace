import { JoiningLobbyOverlay } from '@/components/drafting/JoiningLobbyOverlay';

/**
 * Route-transition loading screen for /draft-room.
 *
 * This is what Next.js shows during the navigation from /drafting → /draft-room
 * (the Suspense boundary while the room mounts). It MUST match the branded
 * "Joining lobby" overlay the drafting page shows during the join — otherwise
 * the hand-off looks glitchy: branded banana overlay → jarring switch to a gray
 * skeleton → lobby. Rendering the SAME overlay here makes the loading screen
 * pixel-identical and continuous straight through the route swap into the lobby,
 * so the "Joining lobby" screen no longer flashes/changes before the lobby paints.
 */
export default function DraftRoomLoading() {
  // `instant` skips the fade-in so this continues the already-visible overlay
  // from /drafting seamlessly (no re-fade flash) across the route hand-off.
  return <JoiningLobbyOverlay show instant />;
}
