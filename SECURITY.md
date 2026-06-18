# 安全策略

## 报告安全问题

如果你发现密钥泄露、服务端接口风险、供应链风险或数据权限问题，请不要公开创建 Issue。请通过 GitHub 仓库所有者提供的私有联系方式报告。

## 密钥处理

- 真实 API Key 只能放在环境变量、`.env.local` 或 `config/secrets/keys.local.mjs`。
- 不要使用 `NEXT_PUBLIC_*` 暴露服务端 Key。
- 提交前运行：

```bash
pnpm audit:keys
```

## 数据处理

- 不要提交真实运行库 `data/wc.db`。
- 不要提交外部 API 原始返回数据，除非确认对应数据源允许公开再分发。
- 样例数据库必须使用人工构造数据。
