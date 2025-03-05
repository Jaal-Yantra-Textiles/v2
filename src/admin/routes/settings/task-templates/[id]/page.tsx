import { UIMatch, useParams } from "react-router-dom";
import { SingleColumnPage } from "../../../../components/pages/single-column-pages";
import { useTaskTemplate } from "../../../../hooks/api/task-templates";
import { TaskTemplateGeneralSection } from "../../../../components/task-templates/task-template-general-section";
import { TaskTemplateCategorySection } from "../../../../components/task-templates/task-template-category-section";
import { SingleColumnPageSkeleton } from "../../../../components/table/skeleton";

export default function TaskTemplateDetailPage() {
  const { id } = useParams();
  const { task_template: template, isPending } = useTaskTemplate(id!, {
    undefined,
  });


  if (isPending || !template) {
    return <SingleColumnPageSkeleton sections={2} showJSON showMetadata />;
  }

  return (
    <SingleColumnPage showJSON showMetadata data={template} hasOutlet={true}>
        <TaskTemplateGeneralSection template={template} />
        <TaskTemplateCategorySection template={template} />
    </SingleColumnPage>
  );
}

export const handle = {
  breadcrumb: (match: UIMatch<{ id: string }>) => {
    const { id } = match.params;
    return `${id}`;
  },
};