
import { DesignNotesSection } from '../../../../components/designs/designs-notes-section';
import { useDesign } from '../../../../hooks/api/designs';
import { useParams } from 'react-router-dom';
import { Skeleton } from '@medusajs/ui';

const AddNoteDocumentForDesign = () => {
  const { id } = useParams();
  const { design, isLoading, isError } = useDesign(id!);
  
  if (isLoading) {
    return (
      <div className="p-6">
        <Skeleton className="w-full h-8 mb-4" />
        <Skeleton className="w-full h-64" />
      </div>
    );
  }
  
  if (isError || !design) {
    return (
      <div className="p-6 text-red-500">
        Error loading design data
      </div>
    );
  }
  
  return (
    <DesignNotesSection 
      designId={design.id}
      initialNotes={design.designer_notes || ""}
    />
  );
};

export default AddNoteDocumentForDesign;