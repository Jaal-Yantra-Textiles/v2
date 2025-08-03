import { Button, Text, Textarea, toast } from "@medusajs/ui";
import { useCallback } from "react";

interface BulkImportSectionProps {
  rawVariables: string;
  onRawVariablesChange: (value: string) => void;
  onParse: (parsedVars: Array<{key: string, value: string}>) => void;
  onCopyAll: () => void;
  parseError: string | null;
}

export const BulkImportSection = ({
  rawVariables,
  onRawVariablesChange,
  onParse,
  onCopyAll,
  parseError
}: BulkImportSectionProps) => {
  const handleParse = useCallback(() => {
    try {
      const lines = rawVariables.trim().split('\n').filter(line => line.trim());
      const parsedVars: Array<{key: string, value: string}> = [];
      
      for (const line of lines) {
        // Parse formats: key=value, key: value, key - value
        let match = line.match(/^([^=:]+)[=:]\s*(.+)$/);
        if (!match) {
          match = line.match(/^([^-]+)\s*-\s*(.+)$/);
        }
        
        if (match) {
          const key = match[1].trim();
          const value = match[2].trim();
          if (key && value) {
            parsedVars.push({ key, value });
          }
        } else if (line.trim() && !line.includes('=') && !line.includes(':') && !line.includes('-')) {
          // Single variable name
          const key = line.trim();
          if (key) {
            parsedVars.push({ key, value: '' });
          }
        }
      }

      onParse(parsedVars);
      toast.success(`Added ${parsedVars.length} variable${parsedVars.length !== 1 ? 's' : ''}`);
    } catch (error) {
      toast.error("Failed to parse variables. Check format and try again.");
    }
  }, [rawVariables, onParse]);

  return (
    <div className="space-y-3">
      <Text size="small" weight="plus" className="text-ui-fg-base">
        Bulk Import Variables
      </Text>
      <Textarea
        placeholder="Paste variables here (key=value, key: value, or key - value format)"
        value={rawVariables}
        onChange={(e) => onRawVariablesChange(e.target.value)}
        className="font-mono text-sm min-h-[120px] bg-ui-bg-field border-ui-border-base focus:border-ui-border-interactive"
      />
      {parseError && (
        <Text size="small" className="text-ui-fg-error">
          {parseError}
        </Text>
      )}
      <div className="flex flex-col sm:flex-row gap-2">
        <Button
          type="button"
          variant="secondary"
          size="small"
          className="w-full sm:w-auto"
          onClick={handleParse}
        >
          Parse Variables
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="small"
          className="w-full sm:w-auto"
          onClick={onCopyAll}
        >
          Copy All Variables
        </Button>
      </div>
    </div>
  );
};
