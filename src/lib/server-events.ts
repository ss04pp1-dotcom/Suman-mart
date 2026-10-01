import { headers, cookies } from "next/headers";
import { recordServerEvent } from "@/lib/tracking";
import { issueTrackingSession, SESSION_COOKIE } from "@/lib/tracking-session";

export { SESSION_COOKIE };

// Session key is stored in a signed first-party cookie pair so server events
// (SignUp, Login, Purchase…) can join the browser tracking session.
export async function ensureSessionKey(): Promise<string> {
  const { sessionKey } = await issueTrackingSession();
  return sessionKey;
}

export async function trackServerEvent(
  event: {
    eventId: string;
    name: string;
    value?: number | null;
    productId?: string | null;
    productName?: string | null;
    quantity?: number | null;
    url?: string | null;
  },
  sessionKey?: string | null
) {
  const key = sessionKey ?? (await cookies()).get(SESSION_COOKIE)?.value ?? null;
  await recordServerEvent(event, { sessionKey: key, headers: await headers() });
}
