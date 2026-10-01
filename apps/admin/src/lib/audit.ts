import { db } from "@/lib/db";
import { stringifyJSON } from "@/lib/json";

/** Append an entry to the admin audit trail. Never throws. */
export async function writeAudit(
  adminId: string | null,
  action: string,
  entity: string,
  entityId?: string | null,
  details?: Record<string, unknown>
) {
  try {
    await db.auditLog.create({
      data: {
        adminId,
        action,
        entity,
        entityId: entityId ?? undefined,
        details: details ? stringifyJSON(details) : null,
      },
    });
  } catch (e) {
    // An audit entry must never break the request, but a silently missed
    // audit is a compliance problem — surface it loudly (console + admin
    // notification) so an operator notices.
    console.error("[audit] failed:", e);
    try {
      await db.notification.create({
        data: {
          type: "SYSTEM",
          title: "Audit log write FAILED",
          message: `Action "${action}" on ${entity}${entityId ? ` (${entityId})` : ""} could not be recorded to the audit trail. Investigate the database.`,
        },
      });
    } catch {
      /* database unavailable — nothing more we can do */
    }
  }
}
