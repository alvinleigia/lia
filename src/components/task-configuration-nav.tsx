import {
  Bot,
  Braces,
  CheckCircle2,
  ListChecks,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const items = [
  { key: "assistant", label: "Assistant", icon: Bot },
  { key: "fields", label: "Fields", icon: Braces },
  { key: "tools", label: "Tools", icon: ShieldCheck },
  { key: "outcomes", label: "Outcomes", icon: ListChecks },
  { key: "review", label: "Review", icon: CheckCircle2 },
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
              href={`/projects/tasks/${taskId}/configure/${item.key}`}
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
