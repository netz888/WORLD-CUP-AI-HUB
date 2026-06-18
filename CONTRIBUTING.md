# 贡献指南

感谢关注 WORLD CUP AI HUB。这个项目欢迎围绕数据质量、模型评估、前端体验、文档和工程稳定性的改进。

## 开发环境

- Node.js 20+
- pnpm 9+

```bash
pnpm install
pnpm dev
```

## 提交前检查

```bash
pnpm lint
pnpm build
pnpm sample:db:verify
pnpm audit:keys
```

如果某个检查因为本地环境限制无法运行，请在 PR 中说明原因和你已经完成的替代验证。

## 数据与密钥规则

- 不要提交真实 API Key。
- 不要提交 `.env.local`。
- 不要提交 `config/secrets/keys.local.mjs`。
- 不要提交真实运行库 `data/wc.db` 或 SQLite 运行态文件。
- `data/sample.wc.db` 只能包含人工构造的样例数据。

## Pull Request 说明

提交 PR 时请说明：

- 改动目的。
- 涉及的数据来源。
- 是否影响预测产物或数据库结构。
- 是否新增环境变量或外部服务依赖。
- 运行过哪些验证命令。

## 预测与免责声明

本项目预测结果仅供娱乐、讨论和技术研究，不构成投注建议。任何涉及模型效果的描述都应保持克制，并明确区分真实赛果、模型输出和人工/LLM 辅助整理内容。
