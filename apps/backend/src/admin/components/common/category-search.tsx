import { Input } from "@medusajs/ui";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

  // The dropdown is rendered in a portal so it escapes the scrollable /
  // overflow-hidden ancestors of the modal it usually lives in (otherwise
  // it gets clipped). We track the anchor input's viewport rect and
  // position the portal with `fixed` coordinates.
  const anchorRef = useRef<HTMLDivElement>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  const updateAnchorRect = useCallback(() => {
    if (anchorRef.current) {
      setAnchorRect(anchorRef.current.getBoundingClientRect());
    }
  }, []);

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

  // Keep the portal aligned with the input while it's open — measure on
  // open and follow scroll/resize so the dropdown tracks the anchor even
  // when the modal body scrolls.
  const isOpen = showCategoryDropdown && matchingCategories.length > 0;

  useLayoutEffect(() => {
    if (!isOpen) {
      return;
    }
    updateAnchorRect();
    window.addEventListener("scroll", updateAnchorRect, true);
    window.addEventListener("resize", updateAnchorRect);
    return () => {
      window.removeEventListener("scroll", updateAnchorRect, true);
      window.removeEventListener("resize", updateAnchorRect);
    };
  }, [isOpen, updateAnchorRect]);

  return (
    <Form.Item>
      <div ref={anchorRef} className="relative">
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
        {isOpen && anchorRect &&
          createPortal(
            <div
              className="z-[100] max-h-48 overflow-y-auto rounded-lg border border-ui-border-base bg-ui-bg-base shadow-elevation-flyout"
              style={{
                position: "fixed",
                top: anchorRect.bottom + 4,
                left: anchorRect.left,
                width: anchorRect.width,
              }}
            >
              {matchingCategories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  className="w-full px-4 py-2 text-left hover:bg-ui-bg-base-hover"
                  // onMouseDown fires before the input's onBlur, so the
                  // selection isn't lost to the blur-close timeout.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleCategorySelect(category);
                  }}
                >
                  {category.name}
                </button>
              ))}
            </div>,
            document.body
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
