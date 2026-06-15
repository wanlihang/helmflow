"use client";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 space-y-4">
      <div className="rounded-md border border-red-200 bg-red-50 p-6 max-w-lg text-center space-y-3">
        <h2 className="text-lg font-semibold text-red-700">页面加载出错</h2>
        <p className="text-sm text-red-600 font-mono break-words">
          {error.message || "发生了未知错误"}
        </p>
        <button
          onClick={reset}
          className="inline-flex items-center rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
        >
          重试
        </button>
      </div>
    </div>
  );
}
