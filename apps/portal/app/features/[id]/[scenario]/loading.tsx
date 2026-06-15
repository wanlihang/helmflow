export default function CellLoading() {
  return (
    <div className="space-y-6">
      <div className="h-4 w-48 animate-pulse rounded bg-muted" />
      <div className="space-y-3 border-b border-border pb-4">
        <div className="h-8 w-80 animate-pulse rounded bg-muted" />
        <div className="flex gap-2">
          <div className="h-5 w-16 animate-pulse rounded bg-muted" />
          <div className="h-5 w-16 animate-pulse rounded bg-muted" />
        </div>
      </div>
      <div className="h-40 animate-pulse rounded-md bg-muted" />
    </div>
  );
}
