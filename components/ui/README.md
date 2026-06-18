# `components/ui/` — 基础组件库

<sub>[← 项目根](../../README.md) · [app](../../app/README.md) · [components](../README.md) · [lib](../../lib/README.md)</sub>

[shadcn/ui](https://ui.shadcn.com) 风格的原子组件（底层 [`@base-ui/react`](https://base-ui.com)）：无样式逻辑 +
Tailwind 主题的可复用基础件，被 [`components/`](../README.md) 的上层功能组件组合使用。

## 组件

| 组件 | 说明 |
| --- | --- |
| `button.tsx` | 按钮，`variant` / `size` 变体（`class-variance-authority`）。 |
| `badge.tsx` | 徽标 / 标签。 |
| `select.tsx` | 下拉选择器（用于时区切换等）。 |

## 约定

- **令牌单一来源**：颜色 / 圆角来自 [`app/globals.css`](../../app/README.md)，改主题改令牌即可，不在此硬改色值。
- **变体用 `cva` 定义**，避免在调用处堆叠条件类名。
- **保持「哑」且通用**：业务逻辑放 [`components/`](../README.md) 上层，这里只做无状态展示。
- **新增组件走 CLI**：

  ```bash
  pnpm dlx shadcn@latest add <component>
  ```
