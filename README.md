# feishu-bitable-cli

一个面向飞书多维表格的命令行工具，支持通过表格 URL 查询记录、通过记录分享 URL 拉取单条详情、更新记录，以及下载记录附件。

## 安装

```bash
npm install -g @acring/feishu-bitable-cli
```

安装后可执行命令：

```bash
feishu-bitable --help
```

## 认证

优先级如下：

1. `--access-token`
2. 当前 shell 已导出的环境变量
3. 当前工作目录下按顺序加载的环境文件：`.env` -> `.env.local` -> `.env.<NODE_ENV>` -> `.env.<NODE_ENV>.local`
4. `FEISHU_ACCESS_TOKEN`
5. `LARK_ACCESS_TOKEN`
6. `FEISHU_USER_ACCESS_TOKEN`
7. `LARK_USER_ACCESS_TOKEN`
8. `FEISHU_APP_ID` + `FEISHU_APP_SECRET`
9. `LARK_APP_ID` + `LARK_APP_SECRET`

可参考 `.env.example`。

## 用法

查询整张表的记录：

```bash
feishu-bitable records "https://xxx.feishu.cn/wiki/xxxx?table=tblxxxx&view=vewxxxx"
```

导出单条记录并下载附件：

```bash
feishu-bitable record \
  "https://xxx.feishu.cn/wiki/xxxx?table=tblxxxx" \
  "https://xxx.feishu.cn/record/recuXXXXXX" \
  --output ./record-1
```

更新单条记录：

```bash
feishu-bitable update-record \
  "https://xxx.feishu.cn/wiki/xxxx?table=tblxxxx" \
  "recxxxxxxxx" \
  --fields '{"文本":"新的内容","数字":100}'
```

如果字段 JSON 较复杂，也可以从文件读取。文件内容既可以是完整请求体中的 `fields` 对象，也可以是 `{ "fields": { ... } }`：

```bash
feishu-bitable update-record \
  "https://xxx.feishu.cn/wiki/xxxx?table=tblxxxx" \
  "recxxxxxxxx" \
  --fields-file ./fields.json \
  --ignore-consistency-check
```

开发阶段直接运行 TypeScript 入口：

```bash
npm run dev -- --help
```

## 发布到 npm

发布前检查：

```bash
npm install
npm run pack:check
```

首次发布 scoped 包建议确认 public access：

```bash
npm login
npm publish
```

当前包已在 `package.json` 中设置 `"publishConfig": { "access": "public" }`。
