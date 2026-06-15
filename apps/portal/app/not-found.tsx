import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-20 space-y-4">
      <h2 className="text-2xl font-bold">404 — 未找到</h2>
      <p className="text-muted-foreground">请求的页面不存在。</p>
      <Link
        href="/"
        className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        返回首页
      </Link>
    </div>
  );
}
