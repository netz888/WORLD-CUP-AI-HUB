/** @type {import('next').NextConfig} */
const nextConfig = {
  // 数据库改用 Node 内置 node:sqlite（见 lib/db/sqlite-node.mjs），为内置模块自动外部化，
  // 无需再声明 better-sqlite3 外部依赖。
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  experimental: {
    viewTransition: true,
    // Windows 上多 worker 静态生成会同时加载 better-sqlite3 + DB，造成内存提交失败 OOM。
    // 强制单 worker 串行生成，慢一点但稳定。
    cpus: 1,
    workerThreads: false,
  },
}

export default nextConfig
