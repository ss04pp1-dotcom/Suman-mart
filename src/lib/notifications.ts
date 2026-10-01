import { db } from "@/lib/db";

export type NotificationType =
  | "ORDER"
  | "PAYMENT"
  | "STOCK"
  | "SUPPLIER"
  | "TRACKING"
  | "REVIEW"
  | "SYSTEM";

/** Create an admin notification. Never throws. */
export async function notify(type: NotificationType, title: string, message: string, link?: string) {
  try {
    await db.notification.create({ data: { type, title, message, link } });
  } catch (e) {
    console.error("[notify] failed:", e);
  }
}
