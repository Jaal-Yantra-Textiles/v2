import { Text, Tooltip, clx } from "@medusajs/ui";
import { CheckCircle, Spinner, XCircle } from "@medusajs/icons";
import { useFolderExtractionStatus } from "../../../hooks/api/textile-extraction";

interface FolderExtractionProgressProps {
  folderId: string;
}

/**
 * Live progress bar for a folder-wide textile extraction run.
 *
 * Reads the folder's `folder_extraction` metadata (mirrored by the workflow) and
 * renders an at-a-glance status strip: a determinate bar with a moving light
 * while running, a green bar when finished, and a red error chip (with a tooltip
 * listing the failed media + reason) when any photo failed.
 */
export const FolderExtractionProgress = ({ folderId }: FolderExtractionProgressProps) => {
  const { data } = useFolderExtractionStatus(folderId, {
    refetchInterval: (query) =>
      query.state.data?.progress?.status === "running" ? 5000 : false,
  });

  const progress = data?.progress;
  if (!progress) return null;

  const { status, total, completed, failed, errors } = progress;
  const running = status === "running";
  const failedRun = status === "failed";

  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const fillPct = failedRun ? 100 : running ? Math.max(pct, 4) : pct;

  const StatusIcon = running ? Spinner : failedRun ? XCircle : CheckCircle;
  const barColor = running ? "bg-blue-500" : failedRun ? "bg-red-500" : "bg-emerald-500";
  const textColor = running ? "text-blue-500" : failedRun ? "text-red-500" : "text-emerald-500";

  return (
    <div className="px-6 py-4">
      <style>{`@keyframes extraction-shimmer { 0% { transform: translateX(-150%); } 100% { transform: translateX(450%); } }`}</style>

      <div className="flex items-center justify-between gap-x-4">
        <div className="flex items-center gap-x-2">
          <StatusIcon className={clx("text-ui-fg-muted", running && "animate-spin")} />
          <Text size="small" weight="plus" className="text-ui-fg-base">
            Feature extraction
          </Text>
          <Text size="xsmall" className={textColor}>
            {running ? "running" : failedRun ? "failed" : "completed"}
          </Text>
        </div>

        <div className="flex items-center gap-x-3">
          <Text size="xsmall" className="text-ui-fg-muted">
            {completed}/{total}
          </Text>

          {failed > 0 &&
            (errors && errors.length > 0 ? (
              <Tooltip
                content={
                  <div className="flex max-h-64 w-80 flex-col gap-y-1.5 overflow-y-auto">
                    <Text size="xsmall" weight="plus" className="text-ui-fg-base">
                      Failed extractions
                    </Text>
                    {errors.map((e) => (
                      <div
                        key={e.media_id}
                        className="rounded-md border border-ui-border-base bg-ui-bg-base p-2"
                      >
                        <Text size="xsmall" weight="plus" className="break-all text-ui-fg-error">
                          {e.media_id}
                        </Text>
                        <Text size="xsmall" className="break-all text-ui-fg-subtle">
                          {e.error}
                        </Text>
                      </div>
                    ))}
                  </div>
                }
              >
                <div className="flex cursor-default items-center gap-x-1 text-red-500">
                  <XCircle />
                  <Text size="xsmall" weight="plus">
                    {failed} failed
                  </Text>
                </div>
              </Tooltip>
            ) : (
              <div className="flex items-center gap-x-1 text-red-500">
                <XCircle />
                <Text size="xsmall" weight="plus">
                  {failed} failed
                </Text>
              </div>
            ))}
        </div>
      </div>

      <div className="relative mt-2 h-1.5 w-full overflow-hidden rounded-full bg-ui-bg-base">
        <div
          className={clx("h-full rounded-full transition-all duration-500", barColor)}
          style={{ width: `${fillPct}%` }}
        />
        {running && (
          <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-full">
            <div
              className="h-full w-1/4 bg-white/40 blur-[2px]"
              style={{ animation: "extraction-shimmer 1.6s ease-in-out infinite" }}
            />
          </div>
        )}
      </div>
    </div>
  );
};