export interface ParsedTableUrl {
  host: string;
  tableId: string;
  viewId?: string;
  source:
    | {
        kind: 'base';
        appToken: string;
      }
    | {
        kind: 'wiki';
        wikiToken: string;
      };
}

export function parseTableUrl(rawUrl: string): ParsedTableUrl {
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`无效的 table URL: ${rawUrl}`);
  }

  const tableId = url.searchParams.get('table');

  if (!tableId) {
    throw new Error('table URL 中缺少 table 参数');
  }

  const viewId = url.searchParams.get('view') ?? undefined;
  const segments = url.pathname.split('/').filter(Boolean);

  if (segments.length < 2) {
    throw new Error(`无法从 URL 解析多维表格标识: ${rawUrl}`);
  }

  const [resourceType, token] = segments;

  if (!token) {
    throw new Error(`无法从 URL 解析 token: ${rawUrl}`);
  }

  if (resourceType === 'base') {
    return {
      host: url.host,
      tableId,
      viewId,
      source: {
        kind: 'base',
        appToken: token,
      },
    };
  }

  if (resourceType === 'wiki') {
    return {
      host: url.host,
      tableId,
      viewId,
      source: {
        kind: 'wiki',
        wikiToken: token,
      },
    };
  }

  throw new Error(`暂不支持的多维表格 URL 形态: ${url.pathname}`);
}
