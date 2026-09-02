import { Button, Text, Tooltip, clx, toast } from "@medusajs/ui";
import { CheckCircle, ExclamationCircle, Spinner, XCircle } from "@medusajs/icons";
import {
  useFolderExtractionStatus,
  useResumeFolderExtraction,
} from "../../../hooks/api/textile-extraction";

interface FolderExtractionProgressProps {
  folderId: string;
}

const minutes = (ms: number | null | undefined) =>
  ms == null ? "" : `${Math.max(1, Math.round(ms / 60000))} min`;

/**
 * Live progress bar for a folder-wide textile extraction run.
 *
 * Reads the folder's `folder_extraction` metadata (mirrored by the workflow) and
 * renders an at-a-glance status strip: a determinate bar with a moving light
 * while running, a green bar when finished, and a red error chip (with a tooltip
 * listing the failed media + reason) when any photo failed.
 *
 * 🔴 A fourth state was missing, and it is the one production was actually in
 * (#1742): **stalled**. The loop runs inside one Node process, so a deploy kills
 * it without writing anything — `status` stays `"running"` for ever. This strip
 * spun a blue "running" bar and polled every 5 seconds for five hours against a
 * job whose process had been replaced twice. The server now decides liveness
 * (three intervals of silence, ten-minute floor) and this renders the verdict,
 * with the button that fixes it.
 */
export const FolderExtractionProgress = ({ folderId }: FolderExtractionProgressProps) => {
  const { data } = useFolderExtractionStatus(folderId, {
    /**
     * ⚠️ Stop polling once the server calls it stalled. Polling a dead job
     * every 5 seconds forever is what the old condition did, and it never
     * changed its mind because nothing was left alive to change it.
     */
    refetchInterval: (query) =>
      query.state.data?.progress?.status === "running" && !query.state.data?.stalled
        ? 5000
        : false,
  });

  const { mutateAsync: resume, isPending: isResuming } = useResumeFolderExtraction();

  const progress = data?.progress;
  if (!progress) return null;

  const { status, total, completed, failed, errors } = progress;
  const stalled = !!data?.stalled;
  const running = status === "running" && !stalled;
  const failedRun = status === "failed";

  /**
   * A resume run's `total` is the remainder, not the folder — so counting only
   * this run would report "3/44" on a 62-image folder that is 21 done. Where
   * the server gave us the folder-wide figures, show those instead.
   */
  const folderTotal = progress.folder_total ?? data?.folder_total ?? total;
  const doneBefore = progress.already_done ?? 0;
  const doneOverall = doneBefore + completed;
  const denominator = folderTotal || total;

  const pct = denominator > 0 ? Math.round((doneOverall / denominator) * 100) : 0;
  const fillPct = failedRun ? 100 : running ? Math.max(pct, 4) : pct;

  const StatusIcon = running
    ? Spinner
    : stalled
      ? ExclamationCircle
      : failedRun
        ? XCircle
        : CheckCircle;

  const barColor = running
    ? "bg-blue-500"
    : stalled
      ? "bg-amber-500"
      : failedRun
        ? "bg-red-500"
        : "bg-emerald-500";

  const textColor = running
    ? "text-blue-500"
    : stalled
      ? "text-amber-500"
      : failedRun
        ? "text-red-500"
        : "text-emerald-500";

  const label = running
    ? "running"
    : stalled
      ? "stopped"
      : failedRun
        ? "failed"
        : "completed";

  const pendingCount = data?.pending_count ?? null;
  const canResume = !!data?.resumable && !running;

  const handleResume = async () => {
    try {
      await resume(folderId);
    } catch (error: any) {
      toast.error(error?.message || "Failed to resume extraction");
    }
  };

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
            {label}
          </Text>
          {stalled && (
            <Tooltip
              content={
                <div className="w-80">
                  <Text size="xsmall">
                    No progress written in {minutes(data?.silent_for_ms)}, and progress is
                    written after every photo. The run processes photos inside a single
                    server process, so a deploy or restart ends it without marking it
                    finished. Resume picks up only the photos that still have no analysis.
                  </Text>
                </div>
              }
            >
              <Text size="xsmall" className="cursor-default text-ui-fg-muted underline decoration-dotted">
                silent {minutes(data?.silent_for_ms)}
              </Text>
            </Tooltip>
          )}
        </div>

        <div className="flex items-center gap-x-3">
          <Text size="xsmall" className="text-ui-fg-muted">
            {doneOverall}/{denominator}
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

          {canResume && (
            <Button
              size="small"
              variant="secondary"
              isLoading={isResuming}
              onClick={handleResume}
            >
              {pendingCount != null ? `Resume (${pendingCount})` : "Resume"}
            </Button>
          )}
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
