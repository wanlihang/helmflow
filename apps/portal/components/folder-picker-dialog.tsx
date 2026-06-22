"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

interface BrowseEntry {
  name: string;
  path: string;
  hasChildren: boolean;
  isProject: boolean;
}

interface BrowseResult {
  currentPath: string;
  parentPath: string | null;
  entries: BrowseEntry[];
  shortcuts: Array<{ label: string; path: string }>;
}

interface FolderPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (path: string) => void;
  /** 初始路径 */
  initialPath?: string;
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

export function FolderPickerDialog({
  open,
  onOpenChange,
  onSelect,
  initialPath,
}: FolderPickerDialogProps) {
  const [currentPath, setCurrentPath] = useState(initialPath ?? "~");
  const [browseResult, setBrowseResult] = useState<BrowseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pathInput, setPathInput] = useState(currentPath);

  // 加载目录内容
  const loadDirectory = useCallback(async (path: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/fs/browse?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (!res.ok) {
        setError((data as { error: string }).error);
        return;
      }
      const result = data as BrowseResult;
      setBrowseResult(result);
      setCurrentPath(result.currentPath);
      setPathInput(result.currentPath);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // 打开时加载初始目录
  useEffect(() => {
    if (open) {
      loadDirectory(initialPath ?? "~");
    }
  }, [open, initialPath, loadDirectory]);

  // 双击进入子目录
  function handleEntryDoubleClick(entry: BrowseEntry) {
    loadDirectory(entry.path);
  }

  // 回到上级
  function handleGoUp() {
    if (browseResult?.parentPath) {
      loadDirectory(browseResult.parentPath);
    }
  }

  // 手动输入路径后回车
  function handlePathSubmit() {
    if (pathInput.trim()) {
      loadDirectory(pathInput.trim());
    }
  }

  // 快捷路径
  function handleShortcut(path: string) {
    loadDirectory(path);
  }

  // 确认选择当前目录
  function handleSelectCurrent() {
    onSelect(currentPath);
    onOpenChange(false);
  }

  // 确认选择子目录
  function handleSelectEntry(entry: BrowseEntry) {
    onSelect(entry.path);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>选择项目目录</DialogTitle>
          <DialogDescription>浏览本地文件系统，选择项目的根目录</DialogDescription>
        </DialogHeader>

        {/* 路径输入栏 */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handlePathSubmit();
            }}
            placeholder="输入路径后回车..."
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleGoUp}
            disabled={!browseResult?.parentPath || loading}
            title="上级目录"
          >
            ↑
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadDirectory(currentPath)}
            disabled={loading}
            title="刷新"
          >
            ↻
          </Button>
        </div>

        {/* 快捷路径 */}
        {browseResult?.shortcuts && browseResult.shortcuts.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {browseResult.shortcuts.map((sc) => (
              <button
                key={sc.path}
                type="button"
                className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => handleShortcut(sc.path)}
              >
                {sc.label}
              </button>
            ))}
          </div>
        )}

        {/* 当前路径显示 */}
        <div className="rounded bg-muted/50 px-3 py-1.5 text-xs font-mono text-muted-foreground truncate">
          {currentPath}
        </div>

        {/* 错误 */}
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
            {error}
          </div>
        )}

        {/* 目录列表 */}
        <div className="flex-1 overflow-auto rounded-md border border-border min-h-[200px] max-h-[400px]">
          {loading && (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
              加载中...
            </div>
          )}
          {!loading && browseResult && browseResult.entries.length === 0 && (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
              此目录下无子目录
            </div>
          )}
          {!loading &&
            browseResult &&
            browseResult.entries.map((entry) => (
              <div
                key={entry.path}
                className="flex items-center justify-between border-b border-border/50 px-3 py-1.5 hover:bg-muted/50 cursor-pointer group"
                onDoubleClick={() => handleEntryDoubleClick(entry)}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm">{entry.isProject ? "📦" : "📁"}</span>
                  <span className="text-sm truncate">{entry.name}</span>
                  {entry.isProject && (
                    <span className="shrink-0 rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">
                      项目
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    className="rounded bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-200"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSelectEntry(entry);
                    }}
                  >
                    选择
                  </button>
                  {entry.hasChildren && <span className="text-xs text-muted-foreground">→</span>}
                </div>
              </div>
            ))}
        </div>

        <DialogFooter className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">双击进入子目录，或点击「选择」确认</span>
          <div className="flex gap-2">
            <DialogClose asChild>
              <Button variant="outline" type="button">
                取消
              </Button>
            </DialogClose>
            <Button type="button" onClick={handleSelectCurrent}>
              选择当前目录
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
