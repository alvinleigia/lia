"use client";

import { Check, Loader2, Plus, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  createProjectFromHeaderAction,
  selectProjectFromHeaderAction,
} from "@/app/projects/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type ProjectOption = {
  id: number;
  name: string;
};

type ProjectSelectorModalProps = {
  selectedProjectId: number;
  selectedProjectLabel: string;
  projects: ProjectOption[];
};

export function ProjectSelectorModal({
  selectedProjectId,
  selectedProjectLabel,
  projects,
}: ProjectSelectorModalProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [createName, setCreateName] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  const filteredProjects = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return projects;
    }

    return projects.filter((project) =>
      project.name.toLowerCase().includes(normalized),
    );
  }, [projects, query]);

  const selectProject = (projectId: number) => {
    setError("");
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.append("projectId", String(projectId));
        await selectProjectFromHeaderAction(formData);
        setOpen(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to select project.");
      }
    });
  };

  const createProject = () => {
    const name = createName.trim();
    if (!name) {
      setError("Project name is required.");
      return;
    }

    setError("");
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.append("name", name);
        await createProjectFromHeaderAction(formData);
        setCreateName("");
        setOpen(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to create project.");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-200"
        >
          Selected Project: {selectedProjectLabel}
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Select a Project</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative">
            <Search className="text-muted-foreground absolute left-3 top-2.5 h-4 w-4" />
            <Input
              className="pl-9"
              placeholder="Search projects..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={isPending}
            />
          </div>

          <div className="max-h-64 overflow-y-auto rounded-md border">
            {filteredProjects.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">
                No matching projects.
              </p>
            ) : (
              <div className="divide-y">
                {filteredProjects.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    className="hover:bg-accent flex w-full items-center justify-between p-3 text-left text-sm"
                    onClick={() => selectProject(project.id)}
                    disabled={isPending}
                  >
                    <div>
                      <p className="font-medium">{project.name}</p>
                      <p className="text-muted-foreground text-xs">
                        ID: {project.id}
                      </p>
                    </div>
                    {project.id === selectedProjectId ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                        <Check className="h-3 w-3" />
                        Selected
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">
                        Select
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="border-t pt-3 space-y-2">
            <p className="text-sm font-medium">Create New Project</p>
            <div className="flex gap-2">
              <Input
                placeholder="e.g. Finance Reports Q2"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                disabled={isPending}
              />
              <Button onClick={createProject} disabled={isPending}>
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Create
              </Button>
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
