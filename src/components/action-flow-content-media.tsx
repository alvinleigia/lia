import { File, FileAudio, FileVideo } from "lucide-react";
import Image from "next/image";
import type { RuntimeReplyMedia } from "@/lib/runtime-replies";

export function ActionFlowContentMedia({
  compact = false,
  media,
}: {
  compact?: boolean;
  media: RuntimeReplyMedia[];
}) {
  if (media.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 grid gap-2">
      {media.map((asset, index) => {
        if (asset.mediaType === "image") {
          return (
            <a
              href={asset.publicPath}
              key={`${asset.id}-${index}`}
              target="_blank"
              rel="noreferrer"
              className="block overflow-hidden rounded-md border bg-white"
            >
              <Image
                alt={asset.originalName}
                className="h-auto w-full object-cover"
                height={compact ? 320 : 480}
                src={asset.publicPath}
                width={compact ? 480 : 720}
              />
              <span className="block truncate border-t px-3 py-2 text-xs text-gray-700">
                {asset.originalName}
              </span>
            </a>
          );
        }

        const AssetIcon =
          asset.mediaType === "video"
            ? FileVideo
            : asset.mediaType === "audio"
              ? FileAudio
              : File;

        return (
          <a
            href={asset.publicPath}
            key={`${asset.id}-${index}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-3 rounded-md border bg-white px-3 py-2 text-gray-800 hover:bg-gray-50"
          >
            <AssetIcon className="h-4 w-4 shrink-0" />
            <span className="min-w-0 truncate text-xs">
              {asset.originalName}
            </span>
          </a>
        );
      })}
    </div>
  );
}
