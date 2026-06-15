"use client";

import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { RegisterProjectDialog } from "@/components/register-project-dialog";

interface Project {
  id: string;
  name: string;
}

interface ProjectSwitcherProps {
  projects: Project[];
  currentProjectId: string;
}

export function ProjectSwitcher({
  projects,
  currentProjectId,
}: ProjectSwitcherProps) {
  const router = useRouter();
  const [selected, setSelected] = useState(currentProjectId);

  useEffect(() => {
    setSelected(currentProjectId);
  }, [currentProjectId]);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newId = e.target.value;
    setSelected(newId);
    document.cookie = `helmflow_project=${encodeURIComponent(newId)};path=/;max-age=${60 * 60 * 24 * 365};SameSite=Lax`;
    router.refresh();
  };

  return (
    <div className="flex items-center gap-1">
      {projects.length <= 1 ? (
        <span className="font-mono text-sm text-muted-foreground">
          {projects[0]?.name ?? currentProjectId}
        </span>
      ) : (
        <select
          value={selected}
          onChange={handleChange}
          className="rounded-md border border-border bg-muted px-2 py-1 text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      <RegisterProjectDialog />
    </div>
  );
}
