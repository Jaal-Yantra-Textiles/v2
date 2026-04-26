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
} from "../../hooks/api/textile-extraction";
import { Spinner } from "../ui/spinner";

type Gender = "female" | "male" | "unisex";

interface TextileExtractionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Single media ID or array of media IDs to extract features from
   */
  mediaIds: string | string[];
  /**
   * Called after successful extraction initiation
   */
  onSuccess?: () => void;
}

export const TextileExtractionModal = ({
  open,
  onOpenChange,
  mediaIds,
  onSuccess,
}: TextileExtractionModalProps) => {
  const [hints, setHints] = useState("");
  const [gender, setGender] = useState<Gender>("unisex");
  const [persist, setPersist] = useState(false);
  const [autoConfirm, setAutoConfirm] = useState(true);

  const singleExtractMutation = useExtractTextileFeatures();
  const confirmMutation = useConfirmExtraction();
  const batchExtractMutation = useBatchExtractTextileFeatures();

  const isSingle = typeof mediaIds === "string";
  const count = isSingle ? 1 : mediaIds.length;

  const handleExtract = async () => {
    const hintsArray = hints
      .split("\n")
      .map((h) => h.trim())
      .filter(Boolean);

    if (isSingle) {
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
      try {
        await batchExtractMutation.mutateAsync({
          media_ids: mediaIds,
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
    onOpenChange(false);
  };

  const isLoading =
    singleExtractMutation.isPending ||
    confirmMutation.isPending ||
    batchExtractMutation.isPending;

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
                  Analyzing {count} {count === 1 ? "image" : "images"}
                </Text>
                <Text size="xsmall" className="text-ui-fg-subtle">
                  AI will extract two data sets: <strong>garment data</strong> for product catalog
                  and <strong>raw internal data</strong> (face, body, model characteristics) for internal use.
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
                  Extract {count > 1 ? `${count} images` : "features"}
                </div>
              )}
            </Button>
          </div>
        </FocusModal.Footer>
      </FocusModal.Content>
    </FocusModal>
  );
};
