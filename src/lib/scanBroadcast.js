// ============================================================
// "You just scanned" — tell every open TaskFlow on your other devices
// ------------------------------------------------------------
// When a notebook scan is logged on the phone, a Realtime broadcast goes out
// on a channel of the person's own (scan-<user id>). Any TaskFlow tab they
// have open (ScanNotifier) and the WordPress panel listen there and show a
// small notice. Broadcast needs no table or SQL; nothing is stored, so a tab
// that's closed at the time simply doesn't hear it.
//
// Sent over REST rather than a joined channel, so the scanning page doesn't
// have to hold a socket open just to say one thing.
// ============================================================
import { supabase } from './supabase';

export const SCAN_EVENT = 'scanned';
export const scanTopic = (uid) => `scan-${uid}`;
// This page's id, so it can ignore its own announcement.
export const TAB_ID = Math.random().toString(36).slice(2, 10);

const SB_URL = process.env.REACT_APP_SUPABASE_URL;
const ANON = process.env.REACT_APP_SUPABASE_ANON_KEY;

// info: { count, teamId, sample: [first few lines] }
export async function announceScan(uid, info) {
  if (!uid || !SB_URL || !ANON) return;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    await fetch(`${SB_URL}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        apikey: ANON,
        'Content-Type': 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify({
        messages: [{
          topic: scanTopic(uid),
          event: SCAN_EVENT,
          private: false,
          payload: { ...info, from: TAB_ID, at: new Date().toISOString() },
        }],
      }),
    });
  } catch { /* a missed notice is harmless */ }
}
