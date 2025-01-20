import { Button, Select } from "@medusajs/ui";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import * as Filter from "../../components/ui/filter";

type Option = {
  label: string;
  value: string;
};

export type FilterType = {
  key: string;
  label: string;
} & (
  | {
      type: "select";
      options: Option[];
      multiple?: boolean;
    }
  | {
      type: "string";
      options?: never;
    }
);

interface CardFiltersProps {
  filters: FilterType[];
  setFilter: (key: string, value: any) => void;
  resetFilter: (key: string) => void;
}

export function CardFilters({
  filters,
  setFilter,
  resetFilter,
}: CardFiltersProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap items-center gap-2">
      {filters.map((filter) => (
        <Filter.Filter key={filter.key}>
          <Filter.Trigger>
            {filter.label}
          </Filter.Trigger>
          <Filter.Content>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                {filter.type === "select" ? (
                  <Select
                    onValueChange={(value) => setFilter(filter.key, value)}
                  >
                    <Select.Trigger className="bg-ui-bg-base border-ui-border-base">
                      <Select.Value placeholder={`Select ${filter.label}`} />
                    </Select.Trigger>
                    <Select.Content>
                      {filter.options.map((option) => (
                        <Select.Item
                          key={option.value}
                          value={option.value}
                          className="bg-ui-bg-base text-ui-fg-base hover:bg-ui-bg-base-hover"
                        >
                          {option.label}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select>
                ) : (
                  <Input
                    type="text"
                    placeholder={`Enter ${filter.label.toLowerCase()}`}
                    onChange={(e) => setFilter(filter.key, e.target.value)}
                    className="bg-ui-bg-base border-ui-border-base"
                  />
                )}
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="transparent"
                  size="small"
                  onClick={() => resetFilter(filter.key)}
                  className="text-ui-fg-subtle hover:bg-ui-bg-base-hover"
                >
                  {t("common.clear", "Clear")}
                </Button>
              </div>
            </div>
          </Filter.Content>
        </Filter.Filter>
      ))}
    </div>
  );
}
