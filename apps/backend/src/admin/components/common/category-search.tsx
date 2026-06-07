import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Form } from "./form";
import { Combobox } from "../inputs/combobox/combobox";

export type Category = {
  id: string;
  name: string;
  description?: string;
};

type CategorySearchProps = {
  defaultValue?: Category | string;
  onSelect: (category: Category | null) => any;
  onValueChange: (value: string) => any;
  categories: Category[];
  error?: string;
};

/**
 * Category picker for raw materials. Backed by the ariakit Combobox
 * (ported from partner-ui / Medusa's dashboard) so the dropdown is a
 * portaled popover that flips and repositions on overflow instead of
 * being clipped by the scrollable create/edit modal it lives in
 * (roadmap bug #1). It keeps the original "type to create a new
 * category" behaviour via the Combobox's onCreateOption affordance.
 *
 * Two call sites with different wiring, both supported:
 *  - the create form passes onSelect/onValueChange that call
 *    field.onChange themselves and return the value;
 *  - the edit form (DynamicForm) injects value/onChange and expects
 *    onSelect/onValueChange to just return the value.
 * We call the callback AND forward its result to the injected onChange,
 * which is a no-op in the create case (onChange is undefined there).
 */
export const CategorySearch = (
  props: CategorySearchProps & Record<string, any>
) => {
  const {
    defaultValue = "",
    onSelect,
    onValueChange,
    categories,
    error,
    // react-hook-form / DynamicForm injected props
    value: formValue,
    onChange: formOnChange,
  } = props;
  const { t } = useTranslation();

  // Resolve the initial selected category name from whatever the caller
  // seeded (an existing-category object, a plain name string, or RHF's
  // current value).
  const initialName = useMemo(() => {
    if (formValue && typeof formValue === "object" && formValue.name) {
      return String(formValue.name);
    }
    if (typeof formValue === "string" && formValue) {
      return formValue;
    }
    if (defaultValue && typeof defaultValue === "object") {
      return defaultValue.name || "";
    }
    if (typeof defaultValue === "string") {
      return defaultValue;
    }
    return "";
    // initial only — subsequent selection is tracked in `selected`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [selected, setSelected] = useState<string>(initialName);
  // Newly typed (not-yet-persisted) names so they still render as the
  // selected label and show up as an option.
  const [createdNames, setCreatedNames] = useState<string[]>(
    initialName && !categories.some((c) => c.name === initialName)
      ? [initialName]
      : []
  );

  const options = useMemo(() => {
    const base = categories.map((c) => ({ value: c.name, label: c.name }));
    const extra = createdNames
      .filter((n) => !categories.some((c) => c.name === n))
      .map((n) => ({ value: n, label: n }));
    return [...base, ...extra];
  }, [categories, createdNames]);

  const handleChange = (val?: string) => {
    if (!val) {
      setSelected("");
      formOnChange?.(onValueChange(""));
      return;
    }
    setSelected(val);
    const existing = categories.find((c) => c.name === val);
    if (existing) {
      formOnChange?.(onSelect(existing));
    }
    // A brand-new value is handled by handleCreate, which the Combobox
    // fires alongside onChange for non-existent options.
  };

  const handleCreate = (name: string) => {
    setCreatedNames((prev) => (prev.includes(name) ? prev : [...prev, name]));
    setSelected(name);
    formOnChange?.(onValueChange(name));
  };

  return (
    <Form.Item>
      <Form.Control>
        <Combobox
          options={options}
          value={selected}
          onChange={handleChange}
          onCreateOption={handleCreate}
          allowClear
          placeholder={t("common.searchOrCreateCategory", "Search or create a category")}
        />
      </Form.Control>
      {error && <Form.ErrorMessage>{error}</Form.ErrorMessage>}
    </Form.Item>
  );
};
