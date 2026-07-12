import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type PageLoaderProps = {
  label?: string;
  className?: string;
};

export function InlineLoader({
  label = "Loading...",
  className,
}: PageLoaderProps) {
  return (
    <output
      className={cn(
        "inline-flex items-center gap-2 text-sm text-muted-foreground",
        className,
      )}
      aria-live="polite"
    >
      <Loader2 className="h-4 w-4 animate-spin" />
      <span>{label}</span>
    </output>
  );
}

export function PageLoader({
  label = "Loading...",
  className,
}: PageLoaderProps) {
  return (
    <main
      className={cn(
        "min-h-[calc(100vh-4rem)] bg-gray-50 px-4 py-12",
        className,
      )}
    >
      <div className="mx-auto flex min-h-64 max-w-3xl items-center justify-center">
        <div className="rounded-md border bg-card px-5 py-4 shadow-sm">
          <InlineLoader label={label} />
        </div>
      </div>
    </main>
  );
}
