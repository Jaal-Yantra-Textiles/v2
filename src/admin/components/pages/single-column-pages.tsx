import { Outlet } from "react-router-dom";

import { PageProps } from "../layout/types";
import { MetadataSection } from "../common/metadata-section";
import { JsonViewSection } from "../common/json-view-section";
import { PublicMetadataSection } from "../common/public-metadata-section";

export const SingleColumnPage = <TData,>({
  children,
  widgets = { before: [], after: [] },
  /**
   * Data of the page which is passed to Widgets, JSON view, and Metadata view.
   */
  data,
  /**
   * Whether the page should render an outlet for children routes. Defaults to true.
   */
  hasOutlet = true,
  /**
   * Whether to show JSON view of the data. Defaults to false.
   */
  showJSON,
  /**
   * Whether to show metadata view of the data. Defaults to false.
   */
  showMetadata,
  /**
   * Whether to show public metadata view of the data. Defaults to false.
   */
  showPublicMetadata,
}: PageProps<TData>) => {
  const { before = [], after = [] } = widgets || {};

  const widgetProps = { data };

  if (showJSON && !data) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        "`showJSON` is true but no data is provided. To display JSON, provide data prop.",
      );
    }

    showJSON = false;
  }

  if (showMetadata && !data) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        "`showMetadata` is true but no data is provided. To display metadata, provide data prop.",
      );
    }

    showMetadata = false;
  }

  if (showPublicMetadata && !data) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        "`showPublicMetadata` is true but no data is provided. To display public metadata, provide data prop.",
      );
    }

    showPublicMetadata = false;
  }

  return (
    <div className="flex flex-col gap-y-3">
      {before.map((Component, i) => {
        return <Component {...widgetProps} key={i} />;
      })}
      {children}
      {after.map((Component, i) => {
        return <Component {...widgetProps} key={i} />;
      })}
      {showMetadata && <MetadataSection data={data!} />}
      {showJSON && <JsonViewSection data={data!} />}
      {showPublicMetadata && <PublicMetadataSection data={data!} />}
      {hasOutlet && <Outlet />}
    </div>
  );
};
