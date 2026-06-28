/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: false,
  },
  // 让 Next.js 直接编译 workspace 包(packages/*)的 TS 源码
  transpilePackages: [
    "@helmflow/contract-schema",
    "@helmflow/agent-core",
    "@helmflow/agent-runner",
    "@helmflow/storage",
    "@helmflow/orchestrator",
    "@helmflow/sandbox-worktree",
    "@helmflow/manifest-loader",
  ],
  // better-sqlite3 是原生模块,绝不可被 bundler 打进 .next/server,
  // 必须保持外部 require 解析,Next.js 才能正确加载 .node 二进制
  serverExternalPackages: ["better-sqlite3"],
  // 透传 terminal-server 端口给浏览器(claude-terminal 组件连 ws://127.0.0.1:PORT)
  env: {
    NEXT_PUBLIC_TERMINAL_PORT: process.env.HELMFLOW_TERMINAL_PORT || "3001",
  },
};

export default nextConfig;
