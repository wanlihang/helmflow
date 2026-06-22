"use client";

import { FolderPickerDialog } from "@/components/folder-picker-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useState } from "react";

const ADAPTER_OPTIONS = [
  { value: "java-ddd", label: "Java DDD (Maven)" },
  { value: "node-express", label: "Node Express (npm)" },
];

interface FormState {
  id: string;
  name: string;
  adapterType: string;
  projectPath: string;
  featureMatrixPath: string;
  standardsRoot: string;
  repoUrl: string;
  description: string;
  analyzeAfterRegister: boolean;
}

const EMPTY_FORM: FormState = {
  id: "",
  name: "",
  adapterType: "java-ddd",
  projectPath: "",
  featureMatrixPath: "",
  standardsRoot: "",
  repoUrl: "",
  description: "",
  analyzeAfterRegister: true,
};

/**
 * 从路径中提取项目名并转为合法 ID。
 * /Users/wanlihang/IdeaProjects/my-java-project → my-java-project
 * C:\Projects\MyProject → myproject
 */
function inferFromPath(path: string): { id: string; name: string } {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const lastSegment = normalized.split("/").pop() ?? "";
  const id = lastSegment
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
  // name 取原始目录名，更可读
  const name = lastSegment.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return { id, name };
}

export function RegisterProjectDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [idHint, setIdHint] = useState("");
  // 追踪用户是否手动编辑过 id 和 name（避免自动填充覆盖用户输入）
  const [userEditedFields, setUserEditedFields] = useState<Set<string>>(new Set());
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);

  function handleOpenChange(val: boolean) {
    setOpen(val);
    if (!val) {
      setForm(EMPTY_FORM);
      setError("");
      setIdHint("");
      setUserEditedFields(new Set());
    }
  }

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (key === "id") {
      setIdHint("");
      setError("");
    }
  }

  /** 路径变化时自动推断项目 ID 和名称 */
  const handlePathChange = useCallback(
    (path: string) => {
      updateField("projectPath", path);

      if (!path.trim()) return;

      const { id, name } = inferFromPath(path.trim());

      // 只在用户未手动编辑过这些字段时自动填充
      setForm((prev) => ({
        ...prev,
        projectPath: path,
        id: userEditedFields.has("id") ? prev.id : prev.id || id,
        name: userEditedFields.has("name") ? prev.name : prev.name || name,
      }));
    },
    [userEditedFields],
  );

  function markUserEdited(field: string) {
    setUserEditedFields((prev) => new Set(prev).add(field));
  }

  async function checkIdAvailability() {
    if (!form.id.trim()) return;
    try {
      const res = await fetch("/api/projects");
      if (res.ok) {
        const data = await res.json();
        const exists = (data.projects as Array<{ id: string }>).some(
          (p) => p.id === form.id.trim(),
        );
        setIdHint(exists ? "此 ID 已被占用" : "✓ 可用");
      }
    } catch {
      // 静默失败
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const payload: Record<string, string> = {
        id: form.id.trim(),
        name: form.name.trim(),
        adapterType: form.adapterType,
        sandboxPath: form.projectPath.trim(),
      };
      if (form.featureMatrixPath.trim()) {
        payload.featureMatrixPath = form.featureMatrixPath.trim();
      }
      if (form.standardsRoot.trim()) {
        payload.standardsRoot = form.standardsRoot.trim();
      }
      if (form.repoUrl.trim()) {
        payload.repoUrl = form.repoUrl.trim();
      }
      if (form.description.trim()) {
        payload.description = form.description.trim();
      }

      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        setError((data as { error: string }).error || "注册失败");
        return;
      }

      // 成功:关闭对话框,刷新页面
      setOpen(false);
      setForm(EMPTY_FORM);
      setUserEditedFields(new Set());
      // 如果勾选了注册并分析，设置一个临时 cookie 标记
      if (form.analyzeAfterRegister) {
        document.cookie = `helmflow_auto_analyze=1;path=/;max-age=60`;
        // 同时切换到新注册的项目
        document.cookie = `helmflow_project=${form.id.trim()};path=/;max-age=${60 * 60 * 24 * 365}`;
      }
      router.refresh();
    } catch (err) {
      setError((err as Error).message || "网络错误");
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    "w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" title="注册新项目">
          <Plus className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>注册新项目</DialogTitle>
          <DialogDescription>输入项目路径，HelmFlow 将自动识别并接入项目</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* 项目路径 — 第一个字段，最重要 */}
          <div>
            <label className="block text-sm font-medium" htmlFor="reg-path">
              项目路径 <span className="text-red-500">*</span>
            </label>
            <div className="flex gap-2">
              <input
                id="reg-path"
                type="text"
                className={`${inputClass} flex-1`}
                placeholder="/Users/xxx/IdeaProjects/my-project"
                value={form.projectPath}
                onChange={(e) => handlePathChange(e.target.value)}
                disabled={submitting}
                autoFocus
              />
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={() => setFolderPickerOpen(true)}
                disabled={submitting}
                title="浏览本地文件夹"
              >
                📂 浏览
              </Button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              输入绝对路径，或点击「浏览」选择项目目录。输入后自动填充项目 ID 和名称
            </p>
          </div>

          {/* 适配器类型 */}
          <div>
            <label className="block text-sm font-medium" htmlFor="reg-adapter">
              适配器类型 <span className="text-red-500">*</span>
            </label>
            <select
              id="reg-adapter"
              className={inputClass}
              value={form.adapterType}
              onChange={(e) => updateField("adapterType", e.target.value)}
              disabled={submitting}
            >
              {ADAPTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* 项目 ID */}
          <div>
            <label className="block text-sm font-medium" htmlFor="reg-id">
              项目 ID <span className="text-red-500">*</span>
            </label>
            <input
              id="reg-id"
              type="text"
              className={inputClass}
              placeholder="my-project"
              value={form.id}
              onChange={(e) => {
                updateField("id", e.target.value);
                markUserEdited("id");
              }}
              onBlur={checkIdAvailability}
              disabled={submitting}
              pattern="^[a-z0-9]([a-z0-9-]*[a-z0-9])?$"
              minLength={2}
              maxLength={64}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              仅限小写字母、数字、连字符,2-64 字符
              {idHint && (
                <span
                  className={idHint.startsWith("✓") ? "ml-2 text-green-600" : "ml-2 text-red-600"}
                >
                  {idHint}
                </span>
              )}
            </p>
          </div>

          {/* 项目名称 */}
          <div>
            <label className="block text-sm font-medium" htmlFor="reg-name">
              项目名称 <span className="text-red-500">*</span>
            </label>
            <input
              id="reg-name"
              type="text"
              className={inputClass}
              placeholder="我的项目"
              value={form.name}
              onChange={(e) => {
                updateField("name", e.target.value);
                markUserEdited("name");
              }}
              disabled={submitting}
              maxLength={200}
            />
          </div>

          {/* 高级选项（折叠） */}
          <details className="rounded-md border border-border">
            <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted/30">
              高级选项
            </summary>
            <div className="space-y-3 p-3">
              {/* Feature Matrix 路径 */}
              <div>
                <label
                  className="block text-xs font-medium text-muted-foreground"
                  htmlFor="reg-matrix"
                >
                  Feature Matrix 路径
                </label>
                <input
                  id="reg-matrix"
                  type="text"
                  className={inputClass}
                  placeholder="留空自动生成"
                  value={form.featureMatrixPath}
                  onChange={(e) => updateField("featureMatrixPath", e.target.value)}
                  disabled={submitting}
                />
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  不填则自动创建 projects/&lt;id&gt;/feature-matrix.yaml
                </p>
              </div>

              {/* 编码规范目录 */}
              <div>
                <label
                  className="block text-xs font-medium text-muted-foreground"
                  htmlFor="reg-std"
                >
                  编码规范目录
                </label>
                <input
                  id="reg-std"
                  type="text"
                  className={inputClass}
                  value={form.standardsRoot}
                  onChange={(e) => updateField("standardsRoot", e.target.value)}
                  disabled={submitting}
                />
              </div>

              {/* Git 仓库地址 */}
              <div>
                <label
                  className="block text-xs font-medium text-muted-foreground"
                  htmlFor="reg-repo"
                >
                  Git 仓库地址
                </label>
                <input
                  id="reg-repo"
                  type="text"
                  className={inputClass}
                  placeholder="https://github.com/..."
                  value={form.repoUrl}
                  onChange={(e) => updateField("repoUrl", e.target.value)}
                  disabled={submitting}
                />
              </div>

              {/* 项目描述 */}
              <div>
                <label
                  className="block text-xs font-medium text-muted-foreground"
                  htmlFor="reg-desc"
                >
                  项目描述
                </label>
                <textarea
                  id="reg-desc"
                  className={inputClass}
                  rows={2}
                  value={form.description}
                  onChange={(e) => updateField("description", e.target.value)}
                  disabled={submitting}
                />
              </div>
            </div>
          </details>

          {/* 是否注册后自动分析 */}
          <div className="flex items-center gap-2">
            <input
              id="reg-analyze"
              type="checkbox"
              checked={form.analyzeAfterRegister}
              onChange={(e) => updateField("analyzeAfterRegister", e.target.checked)}
              disabled={submitting}
              className="accent-blue-600"
            />
            <label htmlFor="reg-analyze" className="text-sm text-muted-foreground">
              注册后自动分析项目结构（推荐）
            </label>
          </div>

          {/* 错误信息 */}
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              <div className="font-semibold">注册失败</div>
              <div className="mt-1 font-mono break-words">{error}</div>
            </div>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" type="button" disabled={submitting}>
                取消
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={submitting || !form.projectPath.trim() || !form.id.trim()}
            >
              {submitting ? "注册中..." : form.analyzeAfterRegister ? "注册并分析" : "注册项目"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>

      {/* 文件夹选择器（独立对话框，注册对话框之上） */}
      <FolderPickerDialog
        open={folderPickerOpen}
        onOpenChange={setFolderPickerOpen}
        onSelect={(path) => {
          handlePathChange(path);
          setFolderPickerOpen(false);
        }}
        initialPath={form.projectPath || undefined}
      />
    </Dialog>
  );
}
