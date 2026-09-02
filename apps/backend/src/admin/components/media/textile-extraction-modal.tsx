import {
  Button,
  FocusModal,
  Textarea,
  Text,
  Heading,
  Switch,
  Label,
  Select,
  Badge,
} from "@medusajs/ui";
import { useState } from "react";
import { Sparkles, InformationCircleSolid } from "@medusajs/icons";
import {
  useBatchExtractTextileFeatures,
  useExtractTextileFeatures,
  useConfirmExtraction,
  useExtractFolderFeatures,
  useConfirmFolderExtraction,
} from "../../hooks/api/textile-extraction";
import { Spinner } from "../ui/spinner";

type Gender = "female" | "male" | "unisex";

/** Human label for a folder-extraction pacing value (milliseconds). */
const pacingLabel = (ms: number) => {
  if (ms < 60000) return `${Math.round(ms / 1000)} seconds`
  const min = ms / 60000
  return min === 1 ? "1 minute" : `${min} minutes`
}

interface TextileExtractionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Single media ID or array of media IDs to extract features from
   */
  mediaIds: string | string[];
  /**
   * When provided, extraction runs as a folder-wide long-running workflow
   * that processes every image in the folder at 1 photo per minute
   * (rate-limited) instead of firing one workflow per photo.
   */
  folderId?: string;
  /**
   * Called after successful extraction initiation
   */
  onSuccess?: () => void;
}

export const TextileExtractionModal = ({
  open,
  onOpenChange,
  mediaIds,
  folderId,
  onSuccess,
}: TextileExtractionModalProps) => {
  const [hints, setHints] = useState("");
  const [gender, setGender] = useState<Gender>("unisex");
  const [persist, setPersist] = useState(false);
  const [autoConfirm, setAutoConfirm] = useState(true);
  const [intervalMs, setIntervalMs] = useState(60000);

  const singleExtractMutation = useExtractTextileFeatures();
  const confirmMutation = useConfirmExtraction();
  const batchExtractMutation = useBatchExtractTextileFeatures();
  const folderExtractMutation = useExtractFolderFeatures();
  const folderConfirmMutation = useConfirmFolderExtraction();

  // Folder mode: one long-running, rate-limited job for the whole folder
  const isFolderMode = typeof folderId === "string" && folderId.length > 0;
  const isSingle = typeof mediaIds === "string" && !isFolderMode;
  const count = isFolderMode ? 0 : isSingle ? 1 : mediaIds.length;

  const handleExtract = async () => {
    const hintsArray = hints
      .split("\n")
      .map((h) => h.trim())
      .filter(Boolean);

    if (isFolderMode) {
      try {
        const result = await folderExtractMutation.mutateAsync({
          folderId: folderId!,
          hints: hintsArray.length > 0 ? hintsArray : undefined,
          gender,
          persist,
          interval_ms: intervalMs,
        });

        if (autoConfirm && result.transaction_id) {
          await folderConfirmMutation.mutateAsync({
            folderId: folderId!,
            transactionId: result.transaction_id,
          });
        }

        handleClose();
        onSuccess?.();
      } catch (error) {
        console.error("Folder extraction failed:", error);
      }
    } else if (isSingle) {
      try {
        const result = await singleExtractMutation.mutateAsync({
          media_id: mediaIds,
          hints: hintsArray.length > 0 ? hintsArray : undefined,
          gender,
          persist,
        });

        if (autoConfirm && result.transaction_id) {
          await confirmMutation.mutateAsync(result.transaction_id);
        }

        handleClose();
        onSuccess?.();
      } catch (error) {
        console.error("Extraction failed:", error);
      }
    } else {
      const batchMediaIds = Array.isArray(mediaIds) ? mediaIds : [];
      try {
        await batchExtractMutation.mutateAsync({
          media_ids: batchMediaIds,
          hints: hintsArray.length > 0 ? hintsArray : undefined,
          gender,
          persist,
          autoConfirm,
        });

        handleClose();
        onSuccess?.();
      } catch (error) {
        console.error("Batch extraction failed:", error);
      }
    }
  };

  const handleClose = () => {
    setHints("");
    setGender("unisex");
    setPersist(false);
    setAutoConfirm(true);
    setIntervalMs(60000);
    onOpenChange(false);
  };

  const isLoading =
    singleExtractMutation.isPending ||
    confirmMutation.isPending ||
    batchExtractMutation.isPending ||
    folderExtractMutation.isPending ||
    folderConfirmMutation.isPending;

  return (
    <FocusModal open={open} onOpenChange={onOpenChange}>
      <FocusModal.Content>
        <FocusModal.Header>
          <div className="flex items-center gap-x-2">
            <Sparkles className="text-ui-fg-interactive" />
            <Heading level="h2">Extract Features</Heading>
          </div>
        </FocusModal.Header>

        <FocusModal.Body className="flex flex-col overflow-y-auto">
          <div className="mx-auto w-full max-w-2xl px-6 py-8 flex flex-col gap-y-8">

            {/* Summary banner */}
            <div className="flex items-start gap-x-3 rounded-xl border border-ui-border-base bg-ui-bg-subtle px-4 py-3">
              <InformationCircleSolid className="mt-0.5 shrink-0 text-ui-fg-interactive" />
              <div className="flex flex-col gap-y-0.5">
                <Text size="small" weight="plus" className="text-ui-fg-base">
                  {isFolderMode
                    ? "Extracting all images in this folder"
                    : `Analyzing ${count} ${count === 1 ? "image" : "images"}`}
                </Text>
                <Text size="xsmall" className="text-ui-fg-subtle">
                  {isFolderMode ? (
                    <>
                      Runs as a long-running background job processing{" "}
                      <strong>{pacingLabel(intervalMs)}</strong> per photo so AI
                      providers are never rate limited. Every image in the folder
                      gets extracted — track progress from the folder page.
                    </>
                  ) : (
                    <>
                      AI first observes <strong>what is visible</strong> (colors,
                      pattern, design, fabric) and then derives garment data for
                      the product catalog plus raw internal data (face, body, model
                      characteristics) for internal use.
                    </>
                  )}
                </Text>
              </div>
            </div>

            {/* What gets extracted */}
            <div className="flex flex-col gap-y-4">
              <Heading level="h3" className="text-ui-fg-base">Extraction scope</Heading>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-y-2 rounded-xl border border-ui-border-base bg-ui-bg-base p-4">
                  <div className="flex items-center gap-x-2">
                    <Badge size="xsmall" color="blue">Garment</Badge>
                    <Text size="xsmall" className="text-ui-fg-muted">product catalog</Text>
                  </div>
                  <Text size="xsmall" className="text-ui-fg-subtle leading-relaxed">
                    Title, description, designer, cloth type, pattern, fabric weight,
                    colors, care instructions, season, occasion, category, SEO keywords,
                    suggested price, target audience
                  </Text>
                </div>
                <div className="flex flex-col gap-y-2 rounded-xl border border-ui-border-base bg-ui-bg-base p-4">
                  <div className="flex items-center gap-x-2">
                    <Badge size="xsmall" color="orange">Internal</Badge>
                    <Text size="xsmall" className="text-ui-fg-muted">not shown to customers</Text>
                  </div>
                  <Text size="xsmall" className="text-ui-fg-subtle leading-relaxed">
                    Face (age range, skin tone, hair, eye color), body (type, height, pose),
                    model characteristics (styling, vibe, shot type, gender presentation)
                  </Text>
                </div>
              </div>
            </div>

            {/* Configuration */}
            <div className="flex flex-col gap-y-4">
              <Heading level="h3" className="text-ui-fg-base">Configuration</Heading>

              <div className="flex flex-col gap-y-5 rounded-xl border border-ui-border-base bg-ui-bg-base p-5">

                {/* Gender context */}
                <div className="flex flex-col gap-y-2">
                  <Label htmlFor="gender" className="text-ui-fg-base">
                    Gender context
                  </Label>
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    Helps AI correctly interpret sizing, fit descriptions, and target audience
                  </Text>
                  <Select value={gender} onValueChange={(v) => setGender(v as Gender)}>
                    <Select.Trigger id="gender" className="w-48">
                      <Select.Value />
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Item value="unisex">Unisex / Unknown</Select.Item>
                      <Select.Item value="female">Female</Select.Item>
                      <Select.Item value="male">Male</Select.Item>
                    </Select.Content>
                  </Select>
                </div>

                <div className="h-px bg-ui-border-base" />

                {/* Pacing (folder mode only — one long-running, rate-limited job) */}
                {isFolderMode && (
                  <>
                    <div className="flex flex-col gap-y-2">
                      <Label htmlFor="interval" className="text-ui-fg-base">
                        Pacing between photos
                      </Label>
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        How long to wait between each image so the AI provider is never rate limited
                      </Text>
                      <Select
                        value={String(intervalMs)}
                        onValueChange={(v) => setIntervalMs(Number(v))}
                      >
                        <Select.Trigger id="interval" className="w-56">
                          <Select.Value />
                        </Select.Trigger>
                        <Select.Content>
                          <Select.Item value="30000">30 seconds</Select.Item>
                          <Select.Item value="60000">1 minute (recommended)</Select.Item>
                          <Select.Item value="120000">2 minutes</Select.Item>
                          <Select.Item value="300000">5 minutes</Select.Item>
                          <Select.Item value="600000">10 minutes</Select.Item>
                        </Select.Content>
                      </Select>
                    </div>

                    <div className="h-px bg-ui-border-base" />
                  </>
                )}

                {/* Extraction hints */}
                <div className="flex flex-col gap-y-2">
                  <Label htmlFor="hints" className="text-ui-fg-base">
                    Extraction hints{" "}
                    <span className="text-ui-fg-muted font-normal">(optional)</span>
                  </Label>
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    One hint per line — guides the AI to pay attention to specific details
                  </Text>
                  <Textarea
                    id="hints"
                    placeholder={"Focus on fabric texture\nIdentify designer label\nNote embroidery details"}
                    value={hints}
                    onChange={(e) => setHints(e.target.value)}
                    rows={3}
                    className="text-sm resize-none"
                  />
                </div>
              </div>
            </div>

            {/* Options */}
            <div className="flex flex-col gap-y-4">
              <Heading level="h3" className="text-ui-fg-base">Options</Heading>

              <div className="flex flex-col divide-y divide-ui-border-base rounded-xl border border-ui-border-base bg-ui-bg-base overflow-hidden">
                {/* Auto-start */}
                <div className="flex items-center justify-between gap-x-4 px-5 py-4">
                  <div className="flex flex-col gap-y-0.5">
                    <Label htmlFor="auto-confirm" className="text-sm text-ui-fg-base">
                      Auto-start processing
                    </Label>
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      Start extraction immediately after initiation without a second confirmation step
                    </Text>
                  </div>
                  <Switch
                    id="auto-confirm"
                    checked={autoConfirm}
                    onCheckedChange={setAutoConfirm}
                  />
                </div>

                {/* Persist */}
                <div className="flex items-center justify-between gap-x-4 px-5 py-4">
                  <div className="flex flex-col gap-y-0.5">
                    <Label htmlFor="persist" className="text-sm text-ui-fg-base">
                      Save to media metadata
                    </Label>
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      Store all extracted results (including raw internal data) in the media file's metadata
                    </Text>
                  </div>
                  <Switch
                    id="persist"
                    checked={persist}
                    onCheckedChange={setPersist}
                  />
                </div>
              </div>
            </div>

          </div>
        </FocusModal.Body>

        <FocusModal.Footer>
          <div className="flex w-full items-center justify-end gap-x-2">
            <Button
              size="small"
              variant="secondary"
              onClick={handleClose}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              size="small"
              variant="primary"
              onClick={handleExtract}
              disabled={isLoading}
            >
              {isLoading ? (
                <div className="flex items-center gap-x-2">
                  <Spinner className="text-ui-fg-on-color" size="sm" />
                  Processing…
                </div>
              ) : (
                <div className="flex items-center gap-x-2">
                  <Sparkles />
                  {isFolderMode
                    ? "Extract all (1 photo/min)"
                    : count > 1
                      ? `Extract ${count} images`
                      : "Extract features"}
                </div>
              )}
            </Button>
          </div>
        </FocusModal.Footer>
      </FocusModal.Content>
    </FocusModal>
  );
};
