import { WidgetEmbedClient } from "@/components/widget-embed-client";
import type { RuntimeAction } from "@/lib/action-runtime";
import { listRuntimeProjectActions } from "@/lib/runtime-actions";
import { resolveWidgetTokenAccess } from "@/lib/widget-keys";

type WidgetEmbedPageProps = {
  searchParams: Promise<{ token?: string }>;
};

export default async function WidgetEmbedPage({
  searchParams,
}: WidgetEmbedPageProps) {
  const params = await searchParams;
  const widgetAccess = params.token
    ? await resolveWidgetTokenAccess(params.token)
    : null;
  const actions: RuntimeAction[] =
    widgetAccess?.isActive &&
    widgetAccess.isTenantActive &&
    !widgetAccess.isArchived
      ? await listRuntimeProjectActions(widgetAccess.projectId)
      : [];

  return (
    <>
      <style>{`
        nav { display: none !important; }
        nextjs-portal { display: none !important; }
      `}</style>
      <WidgetEmbedClient actions={actions} token={params.token ?? ""} />
    </>
  );
}
