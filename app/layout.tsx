import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono, Oswald } from 'next/font/google'
import './globals.css'
import { SiteShell } from '@/components/site-shell'
import { LiveProvider } from '@/components/live-provider'
import { getLiveOverlay } from '@/lib/live-overlay'
import { getChampionRace } from '@/lib/db/champion-sim'
import { getRepoStars } from '@/lib/github'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})
const oswald = Oswald({
  variable: '--font-oswald',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
})

export const metadata: Metadata = {
  title: 'WORLD CUP AI HUB · 世界杯 AI 预测分析',
  description:
    '基于 AI 的世界杯预测分析平台：实时赛程、小组形势、FIFA 排名与每场比赛的智能胜负预测。',
  generator: 'v0.app',
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#0b1220',
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // 服务端拉取实时数据（每 60 秒 revalidate，Key 不外泄）；失败时为空 overlay，降级到静态快照。
  const overlay = await getLiveOverlay()
  // 服务端读夺冠榜实时快照（champion_sim 库，已完赛后由 poller 重算）；DB 空时回退静态基线。
  const championRace = getChampionRace()
  // 服务端拉取仓库 Star 数（缓存 1 小时）；失败返回 null，按钮降级为不显示数字。
  const stars = await getRepoStars()

  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} ${oswald.variable} bg-background`}
    >
      <body className="font-sans antialiased">
        <LiveProvider overlay={overlay} championRace={championRace}>
          <SiteShell stars={stars}>{children}</SiteShell>
        </LiveProvider>
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
