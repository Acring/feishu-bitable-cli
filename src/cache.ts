import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BitableRecord } from './feishu';
import { normalizeRecordUrl, parseRecordUrl } from './record-url';

interface RecordCacheFile {
  version: 1;
  tables: Record<string, TableRecordCache>;
}

interface TableRecordCache {
  byShareToken: Record<string, CachedRecordLocator>;
  bySharedUrl: Record<string, CachedRecordLocator>;
}

interface CachedRecordLocator {
  recordId: string;
  sharedUrl: string;
  cachedAt: string;
}

const DEFAULT_CACHE_DIR = path.join(
  process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache'),
  'feishu-bitable-cli',
);
const CACHE_PATH = path.join(DEFAULT_CACHE_DIR, 'record-cache.json');

export async function findCachedRecordId(
  appToken: string,
  tableId: string,
  recordUrl: string,
): Promise<string | undefined> {
  const cache = await readCacheFile();
  const tableCache = cache.tables[getTableCacheKey(appToken, tableId)];

  if (!tableCache) {
    return undefined;
  }

  const parsedRecordUrl = parseRecordUrl(recordUrl);
  const normalizedUrl = normalizeRecordUrl(recordUrl);

  return (
    tableCache.byShareToken[parsedRecordUrl.shareToken]?.recordId ??
    tableCache.bySharedUrl[normalizedUrl]?.recordId
  );
}

export async function saveRecordLocators(
  appToken: string,
  tableId: string,
  records: BitableRecord[],
): Promise<void> {
  if (records.length === 0) {
    return;
  }

  const cache = await readCacheFile();
  const tableKey = getTableCacheKey(appToken, tableId);
  const tableCache = cache.tables[tableKey] ?? {
    byShareToken: {},
    bySharedUrl: {},
  };

  for (const record of records) {
    if (!record.record_id || typeof record.shared_url !== 'string') {
      continue;
    }

    const normalizedUrl = normalizeRecordUrl(record.shared_url);
    const parsedRecordUrl = parseRecordUrl(normalizedUrl);
    const locator: CachedRecordLocator = {
      recordId: record.record_id,
      sharedUrl: normalizedUrl,
      cachedAt: new Date().toISOString(),
    };

    tableCache.byShareToken[parsedRecordUrl.shareToken] = locator;
    tableCache.bySharedUrl[normalizedUrl] = locator;
  }

  cache.tables[tableKey] = tableCache;
  await writeCacheFile(cache);
}

function getTableCacheKey(appToken: string, tableId: string): string {
  return `${appToken}:${tableId}`;
}

async function readCacheFile(): Promise<RecordCacheFile> {
  try {
    const raw = await readFile(CACHE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<RecordCacheFile>;

    if (parsed.version !== 1 || !parsed.tables || typeof parsed.tables !== 'object') {
      return createEmptyCache();
    }

    return {
      version: 1,
      tables: parsed.tables,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return createEmptyCache();
    }

    return createEmptyCache();
  }
}

async function writeCacheFile(cache: RecordCacheFile): Promise<void> {
  await mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await writeFile(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
}

function createEmptyCache(): RecordCacheFile {
  return {
    version: 1,
    tables: {},
  };
}
