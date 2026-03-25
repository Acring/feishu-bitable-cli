---
name: feishu-bitable-cli
description: Use this skill when you need to use, explain, or troubleshoot the `feishu-bitable` command line tool in this repository, including querying records from a Feishu/Lark Bitable table URL, resolving a single record from a record share URL, updating a record by `record_id`, exporting JSON, downloading attachments, and configuring authentication.
---

# Feishu Bitable CLI

Use this skill for this repository's local CLI. Prefer commands and behaviors from the codebase over generic Feishu API advice.

## Installation

Install the published package:

```bash
npm install -g @acring/feishu-bitable-cli
```

After installation, use the published command name:

```bash
feishu-bitable --help
```

## Supported commands

The real data commands are:

- `records [table-url]`: query all records in a table and print JSON
- `record [table-url] [record-url]`: resolve one shared record, print JSON, and optionally download attachments
- `update-record [table-url] [record-id]`: update one record by `record_id` and print the updated JSON

`greet` and `list` are example commands only. Do not present them as actual Bitable workflows.

## Authentication

Token resolution order is:

1. `--access-token`
2. `FEISHU_ACCESS_TOKEN`
3. `LARK_ACCESS_TOKEN`
4. `FEISHU_USER_ACCESS_TOKEN`
5. `LARK_USER_ACCESS_TOKEN`
6. `FEISHU_APP_ID` + `FEISHU_APP_SECRET`
7. `LARK_APP_ID` + `LARK_APP_SECRET`

If only app credentials are provided, the CLI requests a tenant access token from `/auth/v3/tenant_access_token/internal`.

If needed, the API base URL can be overridden with `FEISHU_OPEN_API_BASE_URL`.

Table URL resolution order is:

1. Command argument `table-url`
2. `FEISHU_BITABLE_TABLE_URL`
3. `LARK_BITABLE_TABLE_URL`
4. `FEISHU_TABLE_URL`
5. `LARK_TABLE_URL`

## URL rules

`table-url` must include `?table=tbl...`.

Supported table URL shapes:

- `https://.../base/<appToken>?table=tbl...`
- `https://.../wiki/<wikiToken>?table=tbl...`

For wiki URLs, the CLI resolves the underlying Bitable app token through the wiki node API.

`record-url` must look like:

- `https://.../record/<shareToken>`

The CLI normalizes record URLs by removing query string, hash, and trailing slash before cache lookup.

## Command details

### `records`

Use this to fetch records from a table or view.

Common options:

- `--page-size <number>`: integer from `1` to `500`
- `--field-names <a,b,c>`: limit returned fields
- `--user-id-type <type>`: defaults to `open_id`
- `--view-id <viewId>`: override the `view` parameter from the URL
- `--filter <json>`: raw JSON passed to the search API
- `--sort <json>`: raw JSON passed to the search API
- `--automatic-fields`: include system fields
- `--output <file>`: write JSON to disk instead of stdout

Example:

```bash
feishu-bitable records "https://xxx.feishu.cn/wiki/xxxx?table=tblxxxx&view=vewxxxx"
```

With environment variable:

```bash
feishu-bitable records
```

Output shape:

- `appToken`
- `tableId`
- `viewId`
- `total`
- `items`

### `record`

Use this to resolve one shared record URL inside a known table.

Common options:

- `--user-id-type <type>`: defaults to `open_id`
- `--automatic-fields`: include system fields
- `--output <dir>`: create a directory, save `record.json`, and download attachments

Example:

```bash
feishu-bitable record \
  "https://xxx.feishu.cn/wiki/xxxx?table=tblxxxx" \
  "https://xxx.feishu.cn/record/recuXXXXXX" \
  --output ./record-1
```

With environment variable:

```bash
feishu-bitable record \
  "https://xxx.feishu.cn/record/recuXXXXXX" \
  --output ./record-1
```

Behavior:

- Tries a local cache first to map record share URL to `record_id`
- Cache file is `~/.cache/feishu-bitable-cli/record-cache.json` unless `XDG_CACHE_HOME` is set
- If cache misses, it searches the full table, batch-fetches record details, and stores the mapping
- Matches records by comparing the record share token from `shared_url`

When `--output` is used:

- JSON is written to `<dir>/record.json`
- Attachments are downloaded to `<dir>/files/`
- Saved attachment paths are returned in the `attachments` array

Attachment filenames are sanitized and deduplicated. The saved filename pattern is based on field name, item index, and original file name.

Output shape:

- `appToken`
- `tableId`
- `recordId`
- `sharedUrl`
- `fromCache`
- `createdTime`
- `lastModifiedTime`
- `createdBy`
- `lastModifiedBy`
- `fields`
- `attachments` when `--output` is used

### `update-record`

Use this to update one known record directly by `record_id`.

Common options:

- `--user-id-type <type>`: defaults to `open_id`
- `--fields <json>`: inline JSON object for fields to update
- `--fields-file <file>`: read update JSON from a file
- `--ignore-consistency-check`: pass `ignore_consistency_check=true` to the API
- `--output <file>`: write JSON to disk instead of stdout

Input rules:

- Exactly one of `--fields` or `--fields-file` must be provided
- The parsed JSON must be an object
- The file or inline JSON may be either the raw fields map, or an object shaped like `{ "fields": { ... } }`
- The CLI does not resolve a record share URL for writes; it needs the concrete `record_id`

Example:

```bash
feishu-bitable update-record \
  "https://xxx.feishu.cn/wiki/xxxx?table=tblxxxx" \
  "recxxxxxxxx" \
  --fields '{"文本":"新的内容","数字":100}'
```

With environment variable:

```bash
feishu-bitable update-record \
  "recxxxxxxxx" \
  --fields '{"文本":"新的内容","数字":100}'
```

Example with file input:

```bash
feishu-bitable update-record \
  "https://xxx.feishu.cn/wiki/xxxx?table=tblxxxx" \
  "recxxxxxxxx" \
  --fields-file ./fields.json \
  --ignore-consistency-check
```

Output shape:

- `appToken`
- `tableId`
- `recordId`
- `sharedUrl`
- `fromCache`
- `createdTime`
- `lastModifiedTime`
- `createdBy`
- `lastModifiedBy`
- `fields`

## Troubleshooting

- If the user passes invalid JSON to `--filter` or `--sort`, the CLI throws an error immediately.
- If the user passes invalid JSON to `--fields` or `--fields-file`, the CLI throws an error immediately.
- If `--page-size` is outside `1..500`, the CLI rejects it.
- If the table URL does not contain `table=...`, parsing fails.
- If the wiki node is not a Bitable node, app token resolution fails.
- If a record cannot be matched by shared URL, the CLI exits with an error after search and batch lookup.
- If both `--fields` and `--fields-file` are provided, or neither is provided, `update-record` exits with an error before calling Feishu.

When helping a user, prefer showing the installed CLI form, `feishu-bitable ...`, not the repository development entrypoint.
