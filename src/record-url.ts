export interface ParsedRecordUrl {
  host: string;
  shareToken: string;
  normalizedUrl: string;
}

export function parseRecordUrl(rawUrl: string): ParsedRecordUrl {
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`无效的 record URL: ${rawUrl}`);
  }

  const segments = url.pathname.split('/').filter(Boolean);

  if (segments.length < 2 || segments[0] !== 'record') {
    throw new Error(`暂不支持的 record URL 形态: ${rawUrl}`);
  }

  const shareToken = segments[1];

  if (!shareToken) {
    throw new Error(`无法从 record URL 解析分享 token: ${rawUrl}`);
  }

  return {
    host: url.host,
    shareToken,
    normalizedUrl: normalizeRecordUrl(rawUrl),
  };
}

export function normalizeRecordUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.search = '';
  url.hash = '';

  const normalizedPath = url.pathname.replace(/\/+$/, '');
  url.pathname = normalizedPath || '/';

  return url.toString();
}
