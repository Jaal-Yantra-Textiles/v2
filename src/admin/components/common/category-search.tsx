import { Input } from "@medusajs/ui";
import { useEffect, useState } from "react";
import { useDebouncedSearch } from "../../hooks/use-debounce";
import { Form } from "./form";
import { useTranslation } from "react-i18next";

export type Category = {
  id: string;
  name: string;
  description?: string;
};

type CategorySearchProps = {
  defaultValue?: Category | string;
  onSelect: (category: Category | null) => void;
  onValueChange: (value: string) => void;
  categories: Category[];
  error?: string;
};

export const CategorySearch = (props: CategorySearchProps & Record<string, any>) => {
  const {
    defaultValue = "",
    onSelect,
    onValueChange,
    categories,
    error,
    // Extract react-hook-form properties
    value: formValue,
    onChange: formOnChange,
    ...otherProps
  } = props;
  const { t } = useTranslation();
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [inputValue, setInputValue] = useState(
    typeof defaultValue === "string" ? defaultValue : defaultValue?.name || ""
  );

  const {
    onSearchValueChange: setCategorySearch,
    query: debouncedQuery,
  } = useDebouncedSearch();

  const matchingCategories = categories.filter(
    (category) => category.name.toLowerCase().includes(inputValue.toLowerCase())
  );

  const hasExactMatch = categories.some(
    (category) => category.name.toLowerCase() === inputValue.toLowerCase()
  );

  const showNewCategoryHint = inputValue && 
    inputValue.length >= 3 && 
    !hasExactMatch;

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);
    
    // When user types, clear any previously selected category
    // and use the typed value instead
    const processedValue = onValueChange(value);
    
    // Update the form field value directly
    if (formOnChange) {
      formOnChange(processedValue);
    }
    
    if (value.length >= 3) {
      setCategorySearch(value);
    } else {
      setCategorySearch("");
      setShowCategoryDropdown(false);
    }
  };

  const handleCategorySelect = (category: Category) => {
    setInputValue(category.name);
    const result = onSelect(category);
    
    // Update the form field value directly
    if (formOnChange) {
      formOnChange(result);
    }
    
    setCategorySearch("");
    setShowCategoryDropdown(false);
  };

  // Set initial category if defaultValue is a Category object
  useEffect(() => {
    if (typeof defaultValue === "object" && defaultValue !== null) {
      const result = onSelect(defaultValue);
      
      // Update the form field value directly
      if (formOnChange) {
        formOnChange(result);
      }
    } else if (formValue === undefined && defaultValue) {
      // If no form value but defaultValue is provided, use it
      if (formOnChange) {
        formOnChange(defaultValue);
      }
    }
  }, [defaultValue, onSelect, formOnChange, formValue]);

  // Update dropdown visibility based on matching categories
  useEffect(() => {
    if (!debouncedQuery || matchingCategories.length === 0) {
      setShowCategoryDropdown(false);
    } else {
      setShowCategoryDropdown(true);
    }
  }, [debouncedQuery, matchingCategories.length]);

  return (
    <Form.Item>
      <div className="relative">
        <Form.Control>
          <Input 
            autoComplete="off" 
            value={inputValue}
            onChange={handleInputChange}
            placeholder={t("common.searchOrCreateCategory")}
            onFocus={() => {
              if (inputValue.length >= 3 && matchingCategories.length > 0) {
                setShowCategoryDropdown(true);
              }
            }}
            onBlur={() => {
              setTimeout(() => setShowCategoryDropdown(false), 200);
            }}
          />
        </Form.Control>
        {showCategoryDropdown && matchingCategories.length > 0 && (
          <div 
            className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-lg border border-ui-border-base bg-ui-bg-base shadow-lg"
          >
            {matchingCategories.map((category) => (
              <button
                key={category.id}
                type="button"
                className="w-full px-4 py-2 text-left hover:bg-ui-bg-base-hover"
                onClick={() => handleCategorySelect(category)}
              >
                {category.name}
              </button>
            ))}
          </div>
        )}
        {showNewCategoryHint && (
          <div className="text-ui-fg-subtle mt-2 text-sm">
            {t("common.pressEnterToCreateCategory")}
          </div>
        )}
      </div>
      {error && <Form.ErrorMessage>{error}</Form.ErrorMessage>}
    </Form.Item>
  );
};
