import { FolderPlus, RefreshCw } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type NoProjectStateProps = {
  title?: string;
};

export function NoProjectState({
  title = "No available project",
}: NoProjectStateProps) {
  return (
    <div className="min-h-screen bg-gray-50 px-4 py-12">
      <div className="mx-auto max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle>{title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Create a project or unarchive an existing one before opening this
              area.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link href="/projects/new">
                  <FolderPlus className="h-4 w-4" />
                  Create Project
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/projects">
                  <RefreshCw className="h-4 w-4" />
                  Manage Projects
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
