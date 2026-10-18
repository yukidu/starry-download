/** Starry ID membership entitlement check. Reads central D1; never trusts UI flags. */
export const STARRY_APP_GRANT_CUTOFF = Date.parse('2026-10-18T16:30:14.903Z');
export async function checkCentralAppEntitlement(db,centralUserId,appId) {
  const row=await db.prepare(`SELECT u.status,u.createdAt,m.status AS membershipStatus,a.decision
    FROM users u
    LEFT JOIN app_memberships m ON m.userId=u.id AND m.appId=?
    LEFT JOIN starry_app_access_decisions a ON a.userId=u.id AND a.appId=?
    WHERE u.id=? LIMIT 1`).bind(appId,appId,centralUserId).first();
  if (!row || row.status!=='active') return {allowed:false,code:'ACCOUNT_INACTIVE'};
  if (row.decision==='deny') return {allowed:false,code:'APP_ACCESS_DENIED'};
  if (row.membershipStatus && row.membershipStatus!=='active') return {allowed:false,code:'MEMBERSHIP_BLOCKED'};
  if (row.decision==='allow') return {allowed:true,code:'OK'};
  const created=Number(row.createdAt);
  if (Number.isFinite(created) && created>=STARRY_APP_GRANT_CUTOFF) return {allowed:false,code:'NEEDS_APPROVAL'};
  return {allowed:true,code:'OK'};
}
