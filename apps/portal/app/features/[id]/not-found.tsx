import Link from "next/link";

export default function FeatureNotFound() {
  return (
    <div className="space-y-4 text-center py-16">
      <h1 className="text-3xl font-bold tracking-tight">Feature not found</h1>
      <p className="text-muted-foreground">
        没有找到对应的功能点,可能 ID 不存在或已被移除。
      </p>
      <div>
        <Link
          href="/"
          className="inline-flex items-center rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          ← 返回全景首页
        </Link>
      </div>
    </div>
  );
}
