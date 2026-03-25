#!/usr/bin/env node

import dotenv from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { program } from 'commander';
import { findCachedRecordId, saveRecordLocators } from '../src/cache';
import {
  batchGetAllRecords,
  downloadMedia,
  resolveAccessToken,
  resolveAppTokenFromWiki,
  searchAllRecords,
  updateRecord,
} from '../src/feishu';
import { parseRecordUrl } from '../src/record-url';
import { parseTableUrl } from '../src/table-url';

interface RecordsCommandOptions {
  accessToken?: string;
  pageSize: string;
  fieldNames?: string;
  userIdType: string;
  viewId?: string;
  filter?: string;
  sort?: string;
  automaticFields?: boolean;
  output?: string;
}

interface RecordCommandOptions {
  accessToken?: string;
  userIdType: string;
  automaticFields?: boolean;
  output?: string;
}

interface UpdateRecordCommandOptions {
  accessToken?: string;
  userIdType: string;
  fields?: string;
  fieldsFile?: string;
  ignoreConsistencyCheck?: boolean;
  output?: string;
}

interface AttachmentCandidate {
  fieldName: string;
  fileToken: string;
  fileName?: string;
  contentType?: string;
}

interface SavedAttachment {
  fieldName: string;
  fileToken: string;
  fileName: string;
  relativePath: string;
  contentType?: string;
}

interface CompactRecordOutput {
  appToken: string;
  tableId: string;
  recordId: string;
  sharedUrl: string | null;
  fromCache: boolean;
  createdTime: unknown;
  lastModifiedTime: unknown;
  createdBy: unknown;
  lastModifiedBy: unknown;
  fields: Record<string, unknown>;
  attachments?: SavedAttachment[];
}

loadEnvironmentFiles();

const CLI_VERSION = resolveCliVersion();

program
  .name('feishu-bitable')
  .description('飞书多维表格 CLI 工具')
  .version(CLI_VERSION);

program.showHelpAfterError();

function loadEnvironmentFiles(): void {
  const initialEnvKeys = new Set(Object.keys(process.env));
  const nodeEnv = process.env.NODE_ENV?.trim();
  const envFiles = [
    '.env',
    '.env.local',
    ...(nodeEnv ? [`.env.${nodeEnv}`, `.env.${nodeEnv}.local`] : []),
  ];

  for (const envFile of envFiles) {
    const envPath = path.resolve(process.cwd(), envFile);
    if (!existsSync(envPath)) {
      continue;
    }

    const parsed = dotenv.parse(readFileSync(envPath, 'utf8'));
    for (const [key, value] of Object.entries(parsed)) {
      if (initialEnvKeys.has(key)) {
        continue;
      }

      process.env[key] = value;
    }
  }
}

program
  .command('greet')
  .description('打个招呼')
  .argument('<name>', '你的名字')
  .option('-u, --upper', '将名字转为大写')
  .action((name: string, options: { upper?: boolean }) => {
    const greeting = options.upper ? name.toUpperCase() : name;
    console.log(`你好, ${greeting}! 欢迎使用飞书多维表格 CLI 🎉`);
  });

program
  .command('list')
  .description('列出所有表格（示例）')
  .option('-l, --limit <number>', '限制返回数量', '10')
  .action((options: { limit: string }) => {
    console.log(`正在获取表格列表（最多 ${options.limit} 条）...`);
    console.log('这里将来会连接飞书 API 获取真实数据');
  });

program
  .command('records')
  .description('通过多维表格 URL 查询记录并输出 JSON')
  .argument(
    '<table-url>',
    '多维表格 URL，例如 https://xxx.feishu.cn/wiki/...?...',
  )
  .option('--access-token <token>', '飞书 access token')
  .option('--page-size <number>', '每页数量，最大 500', '20')
  .option('--field-names <names>', '返回字段名，使用逗号分隔')
  .option('--user-id-type <type>', '用户 ID 类型', 'open_id')
  .option('--view-id <viewId>', '覆盖 URL 中的 view_id')
  .option('--filter <json>', '过滤条件 JSON')
  .option('--sort <json>', '排序条件 JSON')
  .option('--automatic-fields', '包含系统自动字段')
  .option('--output <file>', '将结果写入文件')
  .action(async (tableUrl: string, options: RecordsCommandOptions) => {
    const parsedUrl = parseTableUrl(tableUrl);
    const pageSize = parsePageSize(options.pageSize);
    const accessToken = await resolveAccessToken(options.accessToken);
    const appToken =
      parsedUrl.source.kind === 'base'
        ? parsedUrl.source.appToken
        : await resolveAppTokenFromWiki(parsedUrl.source.wikiToken, accessToken);

    const data = await searchAllRecords(
      {
        appToken,
        tableId: parsedUrl.tableId,
        pageSize,
        userIdType: options.userIdType,
        view_id: options.viewId ?? parsedUrl.viewId,
        field_names: parseFieldNames(options.fieldNames),
        filter: parseJsonOption(options.filter, '--filter'),
        sort: parseJsonOption(options.sort, '--sort'),
        automatic_fields: options.automaticFields,
      },
      accessToken,
    );

    const output = JSON.stringify(
      {
        appToken,
        tableId: parsedUrl.tableId,
        viewId: options.viewId ?? parsedUrl.viewId ?? null,
        total: data.total,
        items: data.items,
      },
      null,
      2,
    );

    if (options.output) {
      const outputPath = path.resolve(options.output);
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, `${output}\n`, 'utf8');
      console.error(`结果已写入 ${outputPath}`);
      return;
    }

    console.log(output);
  });

program
  .command('record')
  .description('通过 table URL 和 record URL 查询单条记录详情并输出 JSON')
  .argument(
    '<table-url>',
    '多维表格 URL，例如 https://xxx.feishu.cn/wiki/...?...',
  )
  .argument(
    '<record-url>',
    '记录分享 URL，例如 https://xxx.feishu.cn/record/xxxxxxxx',
  )
  .option('--access-token <token>', '飞书 access token')
  .option('--user-id-type <type>', '用户 ID 类型', 'open_id')
  .option('--automatic-fields', '包含系统自动字段')
  .option('--output <dir>', '创建输出目录，保存 record.json 和附件文件')
  .action(
    async (
      tableUrl: string,
      recordUrl: string,
      options: RecordCommandOptions,
    ) => {
      const parsedTableUrl = parseTableUrl(tableUrl);
      const parsedRecordUrl = parseRecordUrl(recordUrl);
      const accessToken = await resolveAccessToken(options.accessToken);
      const appToken =
        parsedTableUrl.source.kind === 'base'
          ? parsedTableUrl.source.appToken
          : await resolveAppTokenFromWiki(
              parsedTableUrl.source.wikiToken,
              accessToken,
            );

      let cachedRecordId = await findCachedRecordId(
        appToken,
        parsedTableUrl.tableId,
        parsedRecordUrl.normalizedUrl,
      );
      let fromCache = Boolean(cachedRecordId);
      let detailResponse =
        cachedRecordId === undefined
          ? undefined
          : await batchGetAllRecords(
              {
                appToken,
                tableId: parsedTableUrl.tableId,
                recordIds: [cachedRecordId],
                userIdType: options.userIdType,
                automaticFields: options.automaticFields,
              },
              accessToken,
            );

      let matchedRecord =
        detailResponse?.records.find(
          (record) => hasMatchingShareToken(record.shared_url, parsedRecordUrl.shareToken),
        ) ?? undefined;

      if (!matchedRecord) {
        const searchResult = await searchAllRecords(
          {
            appToken,
            tableId: parsedTableUrl.tableId,
            pageSize: 500,
            userIdType: options.userIdType,
          },
          accessToken,
        );
        const recordIds = searchResult.items
          .map(extractRecordId)
          .filter((recordId): recordId is string => recordId !== undefined);

        detailResponse = await batchGetAllRecords(
          {
            appToken,
            tableId: parsedTableUrl.tableId,
            recordIds,
            userIdType: options.userIdType,
            automaticFields: options.automaticFields,
          },
          accessToken,
        );

        await saveRecordLocators(
          appToken,
          parsedTableUrl.tableId,
          detailResponse.records,
        );

        cachedRecordId = await findCachedRecordId(
          appToken,
          parsedTableUrl.tableId,
          parsedRecordUrl.normalizedUrl,
        );
        fromCache = false;
        matchedRecord =
          detailResponse.records.find(
            (record) => hasMatchingShareToken(record.shared_url, parsedRecordUrl.shareToken),
          ) ?? undefined;
      }

      if (!matchedRecord) {
        throw new Error(
          `未找到匹配的记录: ${parsedRecordUrl.normalizedUrl}（table_id=${parsedTableUrl.tableId}）`,
        );
      }

      const attachments = extractAttachmentCandidates(matchedRecord);
      const compactOutput = buildCompactRecordOutput({
        appToken,
        tableId: parsedTableUrl.tableId,
        fromCache,
        record: matchedRecord,
      });

      if (options.output) {
        const outputDir = path.resolve(options.output);
        await mkdir(outputDir, { recursive: true });
        const savedAttachments = await downloadAttachments(
          attachments,
          outputDir,
          accessToken,
        );
        const outputPath = path.join(outputDir, 'record.json');
        const output = JSON.stringify(
          {
            ...compactOutput,
            attachments: savedAttachments,
          },
          null,
          2,
        );
        await writeFile(outputPath, `${output}\n`, 'utf8');
        console.error(`结果已写入 ${outputPath}`);
        console.error(`附件已保存到 ${path.join(outputDir, 'files')}`);
        return;
      }

      const output = JSON.stringify(
        compactOutput,
        null,
        2,
      );

      console.log(output);
    },
  );

program
  .command('update-record')
  .description('通过 table URL 和 record_id 更新单条记录并输出更新后的 JSON')
  .argument(
    '<table-url>',
    '多维表格 URL，例如 https://xxx.feishu.cn/wiki/...?...',
  )
  .argument(
    '<record-id>',
    '记录 ID，例如 recxxxxxxxx',
  )
  .option('--access-token <token>', '飞书 access token')
  .option('--user-id-type <type>', '用户 ID 类型', 'open_id')
  .option('--fields <json>', '更新字段 JSON，例如 {\"文本\":\"Hello\"}')
  .option('--fields-file <file>', '从文件读取更新字段 JSON')
  .option(
    '--ignore-consistency-check',
    '忽略一致性读写检查，提高性能但可能出现暂时不一致',
  )
  .option('--output <file>', '将结果写入文件')
  .action(
    async (
      tableUrl: string,
      recordId: string,
      options: UpdateRecordCommandOptions,
    ) => {
      const parsedTableUrl = parseTableUrl(tableUrl);
      const accessToken = await resolveAccessToken(options.accessToken);
      const appToken =
        parsedTableUrl.source.kind === 'base'
          ? parsedTableUrl.source.appToken
          : await resolveAppTokenFromWiki(
              parsedTableUrl.source.wikiToken,
              accessToken,
            );
      const fields = parseUpdateFields(options.fields, options.fieldsFile);

      const updatedRecord = await updateRecord(
        {
          appToken,
          tableId: parsedTableUrl.tableId,
          recordId,
          fields,
          userIdType: options.userIdType,
          ignoreConsistencyCheck: options.ignoreConsistencyCheck,
        },
        accessToken,
      );

      const output = JSON.stringify(
        buildCompactRecordOutput({
          appToken,
          tableId: parsedTableUrl.tableId,
          fromCache: false,
          record: updatedRecord,
        }),
        null,
        2,
      );

      if (options.output) {
        const outputPath = path.resolve(options.output);
        await mkdir(path.dirname(outputPath), { recursive: true });
        await writeFile(outputPath, `${output}\n`, 'utf8');
        console.error(`结果已写入 ${outputPath}`);
        return;
      }

      console.log(output);
    },
  );

program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});

function parsePageSize(rawValue: string): number {
  const value = Number(rawValue);

  if (!Number.isInteger(value) || value <= 0 || value > 500) {
    throw new Error('--page-size 必须是 1 到 500 之间的整数');
  }

  return value;
}

function parseFieldNames(rawValue?: string): string[] | undefined {
  if (!rawValue) {
    return undefined;
  }

  const fieldNames = rawValue
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);

  return fieldNames.length > 0 ? fieldNames : undefined;
}

function parseJsonOption(rawValue: string | undefined, flagName: string): unknown {
  if (!rawValue) {
    return undefined;
  }

  try {
    return JSON.parse(rawValue);
  } catch {
    throw new Error(`${flagName} 不是合法的 JSON`);
  }
}

function parseUpdateFields(
  rawFields: string | undefined,
  fieldsFile: string | undefined,
): Record<string, unknown> {
  if (rawFields && fieldsFile) {
    throw new Error('--fields 和 --fields-file 不能同时使用');
  }

  if (!rawFields && !fieldsFile) {
    throw new Error('必须通过 --fields 或 --fields-file 提供要更新的字段');
  }

  const source =
    rawFields ??
    readFileSync(path.resolve(fieldsFile as string), 'utf8');
  const parsed = parseJsonOption(
    source,
    rawFields ? '--fields' : '--fields-file',
  );

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('更新字段必须是 JSON 对象');
  }

  const candidate =
    'fields' in parsed &&
    parsed.fields &&
    typeof parsed.fields === 'object' &&
    !Array.isArray(parsed.fields)
      ? parsed.fields
      : parsed;

  if (Array.isArray(candidate)) {
    throw new Error('更新字段必须是 JSON 对象');
  }

  return candidate as Record<string, unknown>;
}

function extractRecordId(
  item: Record<string, unknown>,
): string | undefined {
  const recordId = item.record_id;
  return typeof recordId === 'string' ? recordId : undefined;
}

function hasMatchingShareToken(
  sharedUrl: unknown,
  shareToken: string,
): boolean {
  if (typeof sharedUrl !== 'string') {
    return false;
  }

  try {
    return parseRecordUrl(sharedUrl).shareToken === shareToken;
  } catch {
    return false;
  }
}

function extractAttachmentCandidates(
  record: Record<string, unknown>,
): AttachmentCandidate[] {
  const fields = record.fields;

  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    return [];
  }

  const attachments: AttachmentCandidate[] = [];

  for (const [fieldName, value] of Object.entries(fields)) {
    collectAttachmentsFromValue(fieldName, value, attachments);
  }

  return attachments;
}

function collectAttachmentsFromValue(
  fieldName: string,
  value: unknown,
  attachments: AttachmentCandidate[],
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectAttachmentsFromValue(fieldName, item, attachments);
    }
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  const candidate = value as Record<string, unknown>;
  const fileToken = candidate.file_token;

  if (typeof fileToken === 'string') {
    attachments.push({
      fieldName,
      fileToken,
      fileName:
        typeof candidate.name === 'string' ? candidate.name : undefined,
      contentType:
        typeof candidate.type === 'string' ? candidate.type : undefined,
    });
    return;
  }

  for (const nestedValue of Object.values(candidate)) {
    collectAttachmentsFromValue(fieldName, nestedValue, attachments);
  }
}

async function downloadAttachments(
  attachments: AttachmentCandidate[],
  outputDir: string,
  accessToken: string,
): Promise<SavedAttachment[]> {
  const filesDir = path.join(outputDir, 'files');
  await mkdir(filesDir, { recursive: true });

  const usedNames = new Set<string>();
  const savedAttachments: SavedAttachment[] = [];

  for (let index = 0; index < attachments.length; index += 1) {
    const attachment = attachments[index];
    const downloaded = await downloadMedia(attachment.fileToken, accessToken);
    const baseName =
      attachment.fileName ??
      downloaded.fileName ??
      `${attachment.fileToken}.bin`;
    const safeName = uniqueFileName(
      usedNames,
      `${sanitizeFileName(attachment.fieldName)}-${index + 1}-${sanitizeFileName(baseName)}`,
    );
    const relativePath = path.join('files', safeName);
    const absolutePath = path.join(outputDir, relativePath);

    await writeFile(absolutePath, downloaded.content);

    savedAttachments.push({
      fieldName: attachment.fieldName,
      fileToken: attachment.fileToken,
      fileName: baseName,
      relativePath,
      contentType: attachment.contentType ?? downloaded.contentType,
    });
  }

  return savedAttachments;
}

function sanitizeFileName(value: string): string {
  const sanitized = value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').trim();
  return sanitized.length > 0 ? sanitized : 'file';
}

function uniqueFileName(usedNames: Set<string>, fileName: string): string {
  const parsed = path.parse(fileName);
  let candidate = fileName;
  let counter = 1;

  while (usedNames.has(candidate)) {
    candidate = `${parsed.name}-${counter}${parsed.ext}`;
    counter += 1;
  }

  usedNames.add(candidate);
  return candidate;
}

function buildCompactRecordOutput(input: {
  appToken: string;
  tableId: string;
  fromCache: boolean;
  record: Record<string, unknown>;
}): CompactRecordOutput {
  const fields = input.record.fields;

  return {
    appToken: input.appToken,
    tableId: input.tableId,
    recordId:
      typeof input.record.record_id === 'string' ? input.record.record_id : '',
    sharedUrl:
      typeof input.record.shared_url === 'string'
        ? input.record.shared_url
        : null,
    fromCache: input.fromCache,
    createdTime: input.record.created_time ?? null,
    lastModifiedTime: input.record.last_modified_time ?? null,
    createdBy: input.record.created_by ?? null,
    lastModifiedBy: input.record.last_modified_by ?? null,
    fields:
      fields && typeof fields === 'object' && !Array.isArray(fields)
        ? (fields as Record<string, unknown>)
        : {},
  };
}

function resolveCliVersion(): string {
  const packageJsonCandidates = [
    path.resolve(__dirname, '..', 'package.json'),
    path.resolve(__dirname, '..', '..', 'package.json'),
  ];

  for (const packageJsonPath of packageJsonCandidates) {
    if (!existsSync(packageJsonPath)) {
      continue;
    }

    const packageJson = JSON.parse(
      readFileSync(packageJsonPath, 'utf8'),
    ) as { version?: unknown };

    if (typeof packageJson.version === 'string') {
      return packageJson.version;
    }
  }

  return '0.0.0';
}
