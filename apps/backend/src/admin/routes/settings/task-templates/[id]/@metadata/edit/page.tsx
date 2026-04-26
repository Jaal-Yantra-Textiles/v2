import {  useParams } from "react-router-dom";
import { useTaskTemplate, useUpdateTaskTemplate } from "../../../../../../hooks/api/task-templates";
import { MetadataForm } from "../../../../../../components/common/medata-form";



const TaskTemplateMetadata = () => {
  const { id } = useParams();
  

  const { task_template: template, isPending, isError, error } = useTaskTemplate(id!);

  const { mutateAsync, isPending: isMutating } = useUpdateTaskTemplate(template?.id!);

  if (isError) {
    throw error;
  }

  return (
    <MetadataForm
      metadata={template?.metadata}
      hook={mutateAsync}
      isPending={isPending}
      isMutating={isMutating}
    />
  );
};

export default TaskTemplateMetadata;


