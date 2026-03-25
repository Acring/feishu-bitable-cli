const OPEN_API_BASE_URL =
  process.env.FEISHU_OPEN_API_BASE_URL ?? 'https://open.feishu.cn/open-apis';

export interface RecordSearchBody {
  view_id?: string;
  field_names?: string[];
  sort?: unknown;
  filter?: unknown;
  automatic_fields?: boolean;
}

export interface SearchRecordsOptions extends RecordSearchBody {
  appToken: string;
  tableId: string;
  userIdType?: string;
  pageSize: number;
}

export interface ListFieldsOptions {
  appToken: string;
  tableId: string;
  viewId?: string;
  pageSize: number;
  textFieldAsArray?: boolean;
}

export interface BitableRecord {
  record_id: string;
  fields?: Record<string, unknown>;
  shared_url?: string;
  record_url?: string;
  [key: string]: unknown;
}

export interface BitableField {
  field_id?: string;
  field_name?: string;
  type?: number;
  ui_type?: string;
  property?: Record<string, unknown> | null;
  is_primary?: boolean;
  is_hidden?: boolean;
  description?: unknown;
  [key: string]: unknown;
}

export interface BatchGetRecordsOptions {
  appToken: string;
  tableId: string;
  recordIds: string[];
  userIdType?: string;
  automaticFields?: boolean;
  withSharedUrl?: boolean;
}

export interface UpdateRecordOptions {
  appToken: string;
  tableId: string;
  recordId: string;
  fields: Record<string, unknown>;
  userIdType?: string;
  ignoreConsistencyCheck?: boolean;
}

export interface DownloadMediaResult {
  content: Uint8Array;
  fileName?: string;
  contentType?: string;
}

interface FeishuEnvelope<T> {
  code: number;
  msg: string;
  data?: T;
  [key: string]: unknown;
}

interface TenantAccessTokenResponse {
  tenant_access_token: string;
  expire?: number;
}

interface WikiNodeData {
  node?: {
    obj_type?: string;
    obj_token?: string;
    title?: string;
  };
  obj_type?: string;
  obj_token?: string;
  title?: string;
}

interface SearchRecordsPage {
  items?: Array<Record<string, unknown>>;
  total?: number;
  page_token?: string;
  has_more?: boolean;
}

interface ListFieldsPage {
  items?: BitableField[];
  total?: number;
  page_token?: string;
  has_more?: boolean;
}

interface BatchGetRecordsResponse {
  records?: BitableRecord[];
  forbidden_record_ids?: string[];
  absent_record_ids?: string[];
}

interface UpdateRecordResponse {
  record?: BitableRecord;
}

export class FeishuApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeishuApiError';
  }
}

export async function resolveAccessToken(cliToken?: string): Promise<string> {
  const directToken =
    cliToken ??
    process.env.FEISHU_ACCESS_TOKEN ??
    process.env.LARK_ACCESS_TOKEN ??
    process.env.FEISHU_USER_ACCESS_TOKEN ??
    process.env.LARK_USER_ACCESS_TOKEN;

  if (directToken) {
    return directToken;
  }

  const appId = process.env.FEISHU_APP_ID ?? process.env.LARK_APP_ID;
  const appSecret =
    process.env.FEISHU_APP_SECRET ?? process.env.LARK_APP_SECRET;

  if (!appId || !appSecret) {
    throw new Error(
      '缺少认证信息。请通过 --access-token 或环境变量 FEISHU_ACCESS_TOKEN 提供 token，或设置 FEISHU_APP_ID / FEISHU_APP_SECRET。',
    );
  }

  const data = await request<TenantAccessTokenResponse>(
    '/auth/v3/tenant_access_token/internal',
    {
      method: 'POST',
      body: {
        app_id: appId,
        app_secret: appSecret,
      },
    },
  );

  if (!data.tenant_access_token) {
    throw new FeishuApiError('获取 tenant_access_token 失败，响应中缺少 token');
  }

  return data.tenant_access_token;
}

export async function resolveAppTokenFromWiki(
  wikiToken: string,
  accessToken: string,
): Promise<string> {
  const data = await request<WikiNodeData>('/wiki/v2/spaces/get_node', {
    method: 'GET',
    accessToken,
    query: {
      token: wikiToken,
    },
  });

  const objType = data.node?.obj_type ?? data.obj_type;
  const objToken = data.node?.obj_token ?? data.obj_token;

  if (!objToken) {
    throw new FeishuApiError('解析 wiki 节点失败，响应中缺少 obj_token');
  }

  if (objType && objType !== 'bitable') {
    throw new FeishuApiError(
      `当前 wiki 节点不是多维表格，obj_type=${objType}`,
    );
  }

  return objToken;
}

export async function searchAllRecords(
  options: SearchRecordsOptions,
  accessToken: string,
): Promise<{
  items: Array<Record<string, unknown>>;
  total: number;
}> {
  const items: Array<Record<string, unknown>> = [];
  let pageToken: string | undefined;
  let total = 0;

  do {
    const page = await request<SearchRecordsPage>(
      `/bitable/v1/apps/${encodeURIComponent(options.appToken)}/tables/${encodeURIComponent(options.tableId)}/records/search`,
      {
        method: 'POST',
        accessToken,
        query: {
          user_id_type: options.userIdType ?? 'open_id',
          page_size: String(options.pageSize),
          ...(pageToken ? { page_token: pageToken } : {}),
        },
        body: {
          ...(options.view_id ? { view_id: options.view_id } : {}),
          ...(options.field_names ? { field_names: options.field_names } : {}),
          ...(options.sort !== undefined ? { sort: options.sort } : {}),
          ...(options.filter !== undefined ? { filter: options.filter } : {}),
          ...(options.automatic_fields !== undefined
            ? { automatic_fields: options.automatic_fields }
            : {}),
        },
      },
    );

    items.push(...(page.items ?? []));
    total = page.total ?? items.length;
    pageToken = page.has_more ? page.page_token : undefined;
  } while (pageToken);

  return {
    items,
    total,
  };
}

export async function batchGetAllRecords(
  options: BatchGetRecordsOptions,
  accessToken: string,
): Promise<{
  records: BitableRecord[];
  forbiddenRecordIds: string[];
  absentRecordIds: string[];
}> {
  if (options.recordIds.length === 0) {
    return {
      records: [],
      forbiddenRecordIds: [],
      absentRecordIds: [],
    };
  }

  const records: BitableRecord[] = [];
  const forbiddenRecordIds = new Set<string>();
  const absentRecordIds = new Set<string>();

  for (let index = 0; index < options.recordIds.length; index += 100) {
    const chunk = options.recordIds.slice(index, index + 100);
    const data = await request<BatchGetRecordsResponse>(
      `/bitable/v1/apps/${encodeURIComponent(options.appToken)}/tables/${encodeURIComponent(options.tableId)}/records/batch_get`,
      {
        method: 'POST',
        accessToken,
        query: {
          user_id_type: options.userIdType ?? 'open_id',
        },
        body: {
          record_ids: chunk,
          user_id_type: options.userIdType ?? 'open_id',
          with_shared_url: options.withSharedUrl ?? true,
          ...(options.automaticFields !== undefined
            ? { automatic_fields: options.automaticFields }
            : {}),
        },
      },
    );

    records.push(...(data.records ?? []));

    for (const recordId of data.forbidden_record_ids ?? []) {
      forbiddenRecordIds.add(recordId);
    }

    for (const recordId of data.absent_record_ids ?? []) {
      absentRecordIds.add(recordId);
    }
  }

  return {
    records,
    forbiddenRecordIds: [...forbiddenRecordIds],
    absentRecordIds: [...absentRecordIds],
  };
}

export async function listAllFields(
  options: ListFieldsOptions,
  accessToken: string,
): Promise<{
  items: BitableField[];
  total: number;
}> {
  const items: BitableField[] = [];
  let pageToken: string | undefined;
  let total = 0;

  do {
    const page = await request<ListFieldsPage>(
      `/bitable/v1/apps/${encodeURIComponent(options.appToken)}/tables/${encodeURIComponent(options.tableId)}/fields`,
      {
        method: 'GET',
        accessToken,
        query: {
          page_size: String(options.pageSize),
          ...(pageToken ? { page_token: pageToken } : {}),
          ...(options.viewId ? { view_id: options.viewId } : {}),
          ...(options.textFieldAsArray !== undefined
            ? { text_field_as_array: String(options.textFieldAsArray) }
            : {}),
        },
      },
    );

    items.push(...(page.items ?? []));
    total = page.total ?? items.length;
    pageToken = page.has_more ? page.page_token : undefined;
  } while (pageToken);

  return {
    items,
    total,
  };
}

export async function updateRecord(
  options: UpdateRecordOptions,
  accessToken: string,
): Promise<BitableRecord> {
  const data = await request<UpdateRecordResponse>(
    `/bitable/v1/apps/${encodeURIComponent(options.appToken)}/tables/${encodeURIComponent(options.tableId)}/records/${encodeURIComponent(options.recordId)}`,
    {
      method: 'PUT',
      accessToken,
      query: {
        user_id_type: options.userIdType ?? 'open_id',
        ...(options.ignoreConsistencyCheck !== undefined
          ? {
              ignore_consistency_check: String(options.ignoreConsistencyCheck),
            }
          : {}),
      },
      body: {
        fields: options.fields,
      },
    },
  );

  if (!data.record) {
    throw new FeishuApiError('更新记录失败，响应中缺少 record');
  }

  return data.record;
}

export async function downloadMedia(
  fileToken: string,
  accessToken: string,
): Promise<DownloadMediaResult> {
  const response = await fetch(
    buildUrl(`/drive/v1/medias/${encodeURIComponent(fileToken)}/download`),
    {
      method: 'GET',
      headers: {
        Accept: '*/*',
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (!response.ok) {
    const rawText = await response.text();
    throw new FeishuApiError(
      `下载附件失败，HTTP ${response.status}: ${rawText || response.statusText}`,
    );
  }

  const contentDisposition = response.headers.get('content-disposition') ?? undefined;
  const arrayBuffer = await response.arrayBuffer();

  return {
    content: new Uint8Array(arrayBuffer),
    fileName: parseContentDispositionFileName(contentDisposition),
    contentType: response.headers.get('content-type') ?? undefined,
  };
}

async function request<T>(
  path: string,
  options: {
    method: 'GET' | 'POST' | 'PUT';
    accessToken?: string;
    query?: Record<string, string>;
    body?: unknown;
  },
): Promise<T> {
  const url = buildUrl(path);

  for (const [key, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    method: options.method,
    headers: {
      Accept: 'application/json; charset=utf-8',
      ...(options.accessToken
        ? {
            Authorization: `Bearer ${options.accessToken}`,
          }
        : {}),
      ...(options.body !== undefined
        ? {
            'Content-Type': 'application/json; charset=utf-8',
          }
        : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const rawText = await response.text();
  let payload: FeishuEnvelope<T> | undefined;

  try {
    payload = rawText ? (JSON.parse(rawText) as FeishuEnvelope<T>) : undefined;
  } catch {
    throw new FeishuApiError(
      `飞书接口返回了无法解析的响应，HTTP ${response.status}: ${rawText}`,
    );
  }

  if (!response.ok) {
    const message = payload?.msg ?? rawText ?? response.statusText;
    const code = payload?.code;
    throw new FeishuApiError(
      `飞书接口请求失败，HTTP ${response.status}${code !== undefined ? `, code=${code}` : ''}: ${message}`,
    );
  }

  if (!payload) {
    throw new FeishuApiError('飞书接口返回为空');
  }

  if (payload.code !== 0) {
    throw new FeishuApiError(
      `飞书接口返回错误，code=${payload.code}: ${payload.msg}`,
    );
  }

  if (payload.data !== undefined) {
    return payload.data;
  }

  return payload as T;
}

function buildUrl(path: string): URL {
  const normalizedBaseUrl = OPEN_API_BASE_URL.endsWith('/')
    ? OPEN_API_BASE_URL
    : `${OPEN_API_BASE_URL}/`;
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
  return new URL(normalizedPath, normalizedBaseUrl);
}

function parseContentDispositionFileName(
  contentDisposition?: string,
): string | undefined {
  if (!contentDisposition) {
    return undefined;
  }

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);

  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }

  const quotedMatch = contentDisposition.match(/filename="([^"]+)"/i);

  if (quotedMatch?.[1]) {
    return quotedMatch[1];
  }

  const plainMatch = contentDisposition.match(/filename=([^;]+)/i);
  return plainMatch?.[1]?.trim();
}
