import {
  BookOpen,
  Bot,
  Braces,
  CheckCircle2,
  History,
  ListChecks,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const items = [
  {
    key: "behavior",
    label: "Behavior",
    icon: Bot,
    path: "assistant",
  },
  {
    key: "context",
    label: "Context",
    icon: Braces,
    path: "fields",
  },
  { key: "tools", label: "Tools", icon: ShieldCheck, path: "tools" },
  {
    key: "knowledge",
    label: "Knowledge",
    icon: BookOpen,
    path: "knowledge",
  },
  {
    key: "workflow",
    label: "Workflow",
    icon: ListChecks,
    path: "outcomes",
  },
  {
    key: "test",
    label: "Test",
    icon: CheckCircle2,
    path: "review",
  },
  {
    key: "versions",
    label: "Versions",
    icon: History,
    path: "versions",
  },
] as const;

export function TaskConfigurationNav({
  active,
  taskId,
}: {
  active: (typeof items)[number]["key"];
  taskId: number;
}) {
  return (
    <nav className="flex flex-wrap gap-2" aria-label="Task configuration">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Button
            key={item.key}
            variant={active === item.key ? "default" : "outline"}
            size="sm"
            asChild
          >
            <Link
              href={`/projects/tasks/${taskId}/configure/${item.path}`}
              className={cn(active === item.key && "pointer-events-none")}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          </Button>
        );
      })}
    </nav>
  );
}
