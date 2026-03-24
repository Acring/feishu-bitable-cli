#!/usr/bin/env tsx

import dotenv from 'dotenv';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { program } from 'commander';
import pkg from '../package.json';
import {
  resolveAccessToken,
  resolveAppTokenFromWiki,
  searchAllRecords,
} from '../src/feishu';
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

dotenv.config({ quiet: true });

program
  .name('feishu-bitable')
  .description('飞书多维表格 CLI 工具')
  .version(pkg.version);

program.showHelpAfterError();

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
  .option('--page-size <number>', '每页数量，最大 500', '500')
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
