import "server-only"
import { GITHUB_REPO_API } from "@/lib/github-config"

/**
 * 服务端拉取仓库 Star 数。
 * - 缓存 5 分钟（revalidate=300）。ISR 缓存为全站访客共享，刷新频率与访问量无关，
 *   每小时最多 12 次请求，远低于 GitHub 未认证接口的 60 次/小时限流。
 * - 任何失败（404 / 限流 / 网络）都返回 null，由 UI 降级为不显示数字。
 */
export async function getRepoStars(): Promise<number | null> {
  try {
    const res = await fetch(GITHUB_REPO_API, {
      headers: { Accept: "application/vnd.github+json" },
      next: { revalidate: 300, tags: ["github-stars"] },
    })
    if (!res.ok) return null
    const data = (await res.json()) as { stargazers_count?: number }
    return typeof data.stargazers_count === "number" ? data.stargazers_count : null
  } catch {
    return null
  }
}
