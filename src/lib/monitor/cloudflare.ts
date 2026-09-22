// Cloudflare API 客户端：GraphQL Analytics + REST
// 文档: https://developers.cloudflare.com/analytics/graphql-api/

const CF_BASE = "https://api.cloudflare.com/client/v4";

export class CloudflareApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloudflareApiError";
  }
}

function authHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

interface TokenVerifyResponse {
  success: boolean;
  errors: { code: number; message: string }[];
  result?: { status: string };
}

async function fetchTokenVerify(url: string, token: string) {
  const res = await fetch(url, {
    headers: authHeaders(token),
    cache: "no-store",
  });
  return (await res.json()) as TokenVerifyResponse;
}

/**
 * 校验 Token 有效性。
 *
 * Cloudflare 有两类 Token，校验端点不同：
 * - user-owned：`/user/tokens/verify`
 * - account-owned（`cfat_` 前缀）：`/user/tokens/verify` 固定返回 401
 *   `Invalid API Token`，必须用 `/accounts/{account_id}/tokens/verify`
 *
 * 先试 user 端点，失败且有 Account ID 时回落到账号级端点。
 */
export async function verifyToken(token: string, accountId?: string) {
  const userJson = await fetchTokenVerify(
    `${CF_BASE}/user/tokens/verify`,
    token
  );
  if (userJson.success) {
    return userJson.result?.status === "active";
  }

  if (accountId) {
    const accountJson = await fetchTokenVerify(
      `${CF_BASE}/accounts/${accountId}/tokens/verify`,
      token
    );
    if (accountJson.success) {
      return accountJson.result?.status === "active";
    }
    throw new CloudflareApiError(
      accountJson.errors?.[0]?.message || "Token 校验失败"
    );
  }

  const message = userJson.errors?.[0]?.message || "Token 校验失败";
  throw new CloudflareApiError(
    token.startsWith("cfat_")
      ? `${message}（这是 Account 级 Token，请同时填写 Account ID）`
      : message
  );
}

/** 校验 Token 是否能访问指定账号 */
export async function verifyAccountAccess(
  token: string,
  accountId: string
): Promise<{ ok: boolean; message: string }> {
  const query = `
    query CheckAccount($accountTag: String!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          accountTag
        }
      }
    }
  `;
  const json = await graphql<{ viewer: { accounts: { accountTag: string }[] } }>(
    token,
    query,
    { accountTag: accountId }
  );
  const accounts = json?.viewer?.accounts ?? [];
  if (accounts.length === 0) {
    return { ok: false, message: "Token 无法访问该 Account ID，请检查账号与权限" };
  }
  return { ok: true, message: "账号访问正常" };
}

/** GraphQL 查询（容忍部分数据集失败） */
export async function graphql<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const res = await fetch(`${CF_BASE}/graphql`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new CloudflareApiError(`GraphQL 请求失败 (HTTP ${res.status})`);
  }
  const json = (await res.json()) as {
    data?: T;
    errors?: { message: string }[];
  };
  if (json.errors && json.errors.length > 0 && !json.data) {
    throw new CloudflareApiError(json.errors[0]?.message || "GraphQL 查询失败");
  }
  return json.data as T;
}

/** REST GET 请求（失败返回 null，不抛异常） */
export async function restGet<T>(
  token: string,
  path: string
): Promise<T | null> {
  try {
    const res = await fetch(`${CF_BASE}${path}`, {
      headers: authHeaders(token),
      cache: "no-store",
    });
    const json = (await res.json()) as {
      success: boolean;
      result?: T;
    };
    if (!json.success || json.result === undefined) return null;
    return json.result;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// GraphQL 数据集结构定义
// ---------------------------------------------------------------------------

export interface WorkersInvocationRow {
  dimensions: { date: string };
  sum: { requests: number } | null;
}

export interface D1AnalyticsRow {
  dimensions: { date: string };
  sum: { rowsRead: number; rowsWritten: number } | null;
}

export interface R2StorageRow {
  dimensions: { date: string };
  max: {
    payloadSize: number;
    metadataSize: number;
    objectCount: number;
  } | null;
}

export interface R2OperationsRow {
  dimensions: { actionType: string; date?: string };
  sum: { requests: number } | null;
}

export interface UsageDataset {
  workersInvocationsAdaptive: WorkersInvocationRow[] | null;
  d1AnalyticsAdaptiveGroups: D1AnalyticsRow[] | null;
  r2StorageAdaptiveGroups: R2StorageRow[] | null;
  r2OperationsAdaptiveGroups: R2OperationsRow[] | null;
}

/** 查询近 N 日用量明细（Workers / D1 / R2 存储 / R2 操作按日分组） */
export function queryUsageTrend(
  token: string,
  accountId: string,
  datetimeFrom: string,
  datetimeTo: string,
  dateFrom: string,
  dateTo: string
) {
  const query = `
    query UsageTrend(
      $accountTag: String!
      $datetimeFrom: Time!
      $datetimeTo: Time!
      $dateFrom: Date!
      $dateTo: Date!
    ) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          workersInvocationsAdaptive(
            limit: 100000
            filter: { datetime_geq: $datetimeFrom, datetime_leq: $datetimeTo }
            orderBy: [date_ASC]
          ) {
            dimensions { date }
            sum { requests }
          }
          d1AnalyticsAdaptiveGroups(
            limit: 10000
            filter: { date_geq: $dateFrom, date_leq: $dateTo }
            orderBy: [date_ASC]
          ) {
            dimensions { date }
            sum { rowsRead rowsWritten }
          }
          r2StorageAdaptiveGroups(
            limit: 31
            filter: { date_geq: $dateFrom, date_leq: $dateTo }
            orderBy: [date_DESC]
          ) {
            dimensions { date }
            max { payloadSize metadataSize objectCount }
          }
          r2OperationsAdaptiveGroups(
            limit: 10000
            filter: { datetime_geq: $datetimeFrom, datetime_leq: $datetimeTo }
          ) {
            dimensions { actionType date }
            sum { requests }
          }
        }
      }
    }
  `;
  return graphql<{ viewer: { accounts: { [k: string]: UsageDataset }[] } }>(
    token,
    query,
    { accountTag: accountId, datetimeFrom, datetimeTo, dateFrom, dateTo }
  );
}

/** 查询本月至今的 R2 操作（按操作类型分组） */
export function queryR2MonthlyOperations(
  token: string,
  accountId: string,
  datetimeFrom: string,
  datetimeTo: string
) {
  const query = `
    query R2Monthly($accountTag: String!, $datetimeFrom: Time!, $datetimeTo: Time!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          r2OperationsAdaptiveGroups(
            limit: 10000
            filter: { datetime_geq: $datetimeFrom, datetime_leq: $datetimeTo }
          ) {
            dimensions { actionType }
            sum { requests }
          }
        }
      }
    }
  `;
  return graphql<{
    viewer: { accounts: { r2OperationsAdaptiveGroups: R2OperationsRow[] }[] };
  }>(token, query, { accountTag: accountId, datetimeFrom, datetimeTo });
}

/** R2 操作类型 → Class A/B 分类（未收录的操作不计入） */
const R2_CLASS_A_ACTIONS = new Set([
  "PutObject",
  "CopyObject",
  "CompleteMultipartUpload",
  "CreateBucket",
  "DeleteBucket",
  "InitiateMultipartUpload",
  "UploadPart",
  "UploadPartCopy",
  "ListMultipartUploads",
  "ListParts",
  "ListBuckets",
  "HeadBucket",
  "ListObjects",
  "ListObjectsV2",
]);

const R2_CLASS_B_ACTIONS = new Set([
  "GetObject",
  "HeadObject",
  "UsageReport",
]);

export function classifyR2Action(actionType: string): "A" | "B" | null {
  if (R2_CLASS_A_ACTIONS.has(actionType)) return "A";
  if (R2_CLASS_B_ACTIONS.has(actionType)) return "B";
  return null;
}

/** 获取 D1 数据库列表（用于统计存储总量） */
export async function getD1StorageBytes(
  token: string,
  accountId: string
): Promise<number | null> {
  const rows = await restGet<{ file_size?: number }[]>(
    token,
    `/accounts/${accountId}/d1/database`
  );
  if (!rows) return null;
  return rows.reduce((acc, row) => acc + (row.file_size ?? 0), 0);
}
