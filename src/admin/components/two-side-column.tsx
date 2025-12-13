import React from "react";

type TwoColumnLayoutProps = {
  firstCol: React.ReactNode;
  secondCol: React.ReactNode;
  /**
   * When enabled, the sidebar sticks on desktop for better wayfinding.
   * Defaults to false to avoid unexpected layout changes.
   */
  stickySecondCol?: boolean;
  /** Optional class overrides */
  className?: string;
  firstColClassName?: string;
  secondColClassName?: string;
};

export const TwoColumnLayout = ({
  firstCol,
  secondCol,
  stickySecondCol = false,
  className,
  firstColClassName,
  secondColClassName,
}: TwoColumnLayoutProps) => {
  return (
    <div
      className={`flex flex-col gap-x-4 gap-y-3 xl:flex-row xl:items-start ${
        className || ""
      }`}
    >
      <div className={`flex w-full flex-col gap-y-3 ${firstColClassName || ""}`}>
        {firstCol}
      </div>
      <div
        className={`flex w-full max-w-[100%] flex-col gap-y-3 xl:mt-0 xl:max-w-[440px] ${
          stickySecondCol ? "xl:sticky xl:top-6" : ""
        } ${secondColClassName || ""}`}
      >
        {secondCol}
      </div>
    </div>
  );
};
