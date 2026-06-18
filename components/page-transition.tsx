import { ViewTransition } from "react"

/**
 * 层级导航的方向过渡：列表 → 详情 用 nav-forward（右进左出），
 * 详情 → 列表 用 nav-back（左进右出）。横向 tab 导航不设 type，default="none" 不触发。
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition
      enter={{ "nav-forward": "nav-forward", "nav-back": "nav-back", default: "none" }}
      exit={{ "nav-forward": "nav-forward", "nav-back": "nav-back", default: "none" }}
      default="none"
    >
      {children}
    </ViewTransition>
  )
}
