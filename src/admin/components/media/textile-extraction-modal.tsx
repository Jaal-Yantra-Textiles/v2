import {
  Button,
  FocusModal,
  Textarea,
  Text,
  Heading,
  Switch,
  Label,
} from "@medusajs/ui";
import { useState } from "react";
import { Sparkles } from "@medusajs/icons";
import {
  useBatchExtractTextileFeatures,
  useExtractTextileFeatures,
  useConfirmExtraction,
} from "../../hooks/api/textile-extraction";
import { Spinner } from "../ui/spinner";

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
      // Single media extraction
      try {
        const result = await singleExtractMutation.mutateAsync({
          media_id: mediaIds,
          hints: hintsArray.length > 0 ? hintsArray : undefined,
          persist,
        });

        // Auto-confirm if enabled
        if (autoConfirm && result.transaction_id) {
          await confirmMutation.mutateAsync(result.transaction_id);
        }

        handleClose();
        onSuccess?.();
      } catch (error) {
        // Error is handled by the mutation's onError
        console.error("Extraction failed:", error);
      }
    } else {
      // Batch extraction
      try {
        await batchExtractMutation.mutateAsync({
          media_ids: mediaIds,
          hints: hintsArray.length > 0 ? hintsArray : undefined,
          persist,
          autoConfirm,
        });

        handleClose();
        onSuccess?.();
      } catch (error) {
        // Error is handled by the mutation's onError
        console.error("Batch extraction failed:", error);
      }
    }
  };

  const handleClose = () => {
    setHints("");
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
            <Heading>Extract Textile Features</Heading>
          </div>
        </FocusModal.Header>

        <FocusModal.Body className="flex flex-col">
          {/* Info Section */}
          <div className="mb-6">
            <Text size="small" className="text-ui-fg-subtle">
              Extract e-commerce product information from{" "}
              <span className="font-medium text-ui-fg-base">{count}</span>{" "}
              textile {count === 1 ? "image" : "images"} using AI. Extracted
              data includes designer, fabric type, colors, care instructions,
              and more.
            </Text>
          </div>

          {/* Form Fields */}
          <div className="flex flex-col gap-y-4">
            {/* Hints Field */}
            <div className="flex flex-col gap-y-2">
              <Label htmlFor="hints" className="text-ui-fg-subtle">
                Extraction Hints{" "}
                <span className="text-ui-fg-muted">(optional)</span>
              </Label>
              <Textarea
                id="hints"
                placeholder="Focus on fabric texture&#10;Identify designer label&#10;Look for care instructions tag"
                value={hints}
                onChange={(e) => setHints(e.target.value)}
                rows={3}
                className="text-sm"
              />
              <Text size="xsmall" className="text-ui-fg-muted">
                One hint per line to guide AI extraction
              </Text>
            </div>

            {/* Options */}
            <div className="flex flex-col gap-y-3 rounded-lg border border-ui-border-base p-4">
              <Text size="small" weight="plus" className="text-ui-fg-base">
                Options
              </Text>

              {/* Persist Toggle */}
              <div className="flex items-center justify-between gap-x-4">
                <div className="flex-1">
                  <Label htmlFor="persist" className="text-sm">
                    Save to metadata
                  </Label>
                  <Text size="xsmall" className="text-ui-fg-muted">
                    Store results in media file metadata
                  </Text>
                </div>
                <Switch
                  id="persist"
                  checked={persist}
                  onCheckedChange={setPersist}
                />
              </div>

              {/* Auto-confirm Toggle */}
              <div className="flex items-center justify-between gap-x-4">
                <div className="flex-1">
                  <Label htmlFor="auto-confirm" className="text-sm">
                    Auto-start processing
                  </Label>
                  <Text size="xsmall" className="text-ui-fg-muted">
                    Start extraction immediately after initiation
                  </Text>
                </div>
                <Switch
                  id="auto-confirm"
                  checked={autoConfirm}
                  onCheckedChange={setAutoConfirm}
                />
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
                  <Spinner className="text-ui-fg-on-color" size="small" />
                  Processing...
                </div>
              ) : (
                <div className="flex items-center gap-x-2">
                  <Sparkles />
                  Extract Features
                </div>
              )}
            </Button>
          </div>
        </FocusModal.Footer>
      </FocusModal.Content>
    </FocusModal>
  );
};
