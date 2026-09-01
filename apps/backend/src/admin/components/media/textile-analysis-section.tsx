import { Badge, Heading, Skeleton, Text } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import {
  useTextileAnalyses,
  AdminTextileAnalysis,
} from "../../hooks/api/textile-analyses"

/**
 * "What the vision model saw in this photo" — the textile analysis linked to
 * one media file, rendered as the folder gallery's analysis panel.
 *
 * Reads `GET /admin/textile-analyses?media_id=…` (the reverse direction of the
 * textile library's analysis→media hydration), so a photo that has been run
 * through folder/per-media extraction (or the backfill) shows its findings here.
 */
export const TextileAnalysisSection = ({ mediaId }: { mediaId: string }) => {
  const { t } = useTranslation()
  const { data, isLoading } = useTextileAnalyses({ media_id: mediaId, limit: 5 })

  const analyses = data?.textile_analyses ?? []
  const analysis: AdminTextileAnalysis | undefined = analyses[0]

  return (
    <div className="flex flex-col gap-y-4 p-4">
      <div>
        <Heading level="h3" className="text-base">
          {t("media.textileAnalysis.title", "Textile analysis")}
        </Heading>
        <Text size="xsmall" className="text-ui-fg-muted">
          {t(
            "media.textileAnalysis.subtitle",
            "What the vision model saw in this photo"
          )}
        </Text>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-y-3">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-4 w-full" />
        </div>
      ) : !analysis ? (
        <div className="border-ui-border-base flex flex-col gap-y-1 rounded-lg border border-dashed p-4">
          <Text size="small" className="text-ui-fg-subtle">
            {t("media.textileAnalysis.empty", "No analysis yet.")}
          </Text>
          <Text size="xsmall" className="text-ui-fg-muted">
            {t(
              "media.textileAnalysis.emptyHint",
              "Run folder extraction on this folder, or the backfill-textile-analysis maintenance job."
            )}
          </Text>
        </div>
      ) : (
        <div className="flex flex-col gap-y-3">
          {analysis.title && (
            <Text size="small" weight="plus">
              {analysis.title}
            </Text>
          )}

          {analysis.description && (
            <Text size="xsmall" className="text-ui-fg-subtle">
              {analysis.description}
            </Text>
          )}

          <div className="flex flex-wrap gap-1">
            {analysis.cloth_type && (
              <Badge size="2xsmall" color="blue">
                {analysis.cloth_type}
              </Badge>
            )}
            {analysis.pattern && (
              <Badge size="2xsmall" color="purple">
                {analysis.pattern}
              </Badge>
            )}
            {analysis.fabric_weight && (
              <Badge size="2xsmall" color="grey">
                {analysis.fabric_weight.replace(/-/g, " ")}
              </Badge>
            )}
            {analysis.weave_or_knit && (
              <Badge size="2xsmall" color="green">
                {analysis.weave_or_knit}
              </Badge>
            )}
            {analysis.primary_color && (
              <Badge size="2xsmall" color="orange">
                {analysis.primary_color}
              </Badge>
            )}
            {analysis.source === "storefront_reference" && (
              <Badge size="2xsmall" color="red">
                {t("media.textileAnalysis.customerPhoto", "customer photo")}
              </Badge>
            )}
          </div>

          {Array.isArray(analysis.colors) && analysis.colors.length > 0 && (
            <div className="flex flex-col gap-y-1">
              <Text size="xsmall" weight="plus" className="text-ui-fg-muted">
                {t("media.textileAnalysis.colors", "Colors")}
              </Text>
              <div className="flex flex-wrap gap-1">
                {analysis.colors.map((c) => (
                  <Badge key={c} size="2xsmall" color="grey">
                    {c}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {typeof analysis.confidence === "number" && (
            <Text size="xsmall" className="text-ui-fg-muted">
              {t("media.textileAnalysis.confidence", "{{pct}}% confident", {
                pct: Math.round(analysis.confidence * 100),
              })}
            </Text>
          )}
        </div>
      )}
    </div>
  )
}