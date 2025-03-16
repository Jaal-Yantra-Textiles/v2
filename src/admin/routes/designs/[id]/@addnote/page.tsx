import {useParams} from 'react-router-dom'
import { DesignNotesSection } from '../../../../components/designs/designs-notes-section';

const AddNoteDocumentForDesign = () => {
    const { id } = useParams()
  return (
    
    <DesignNotesSection />
  );
};

export default AddNoteDocumentForDesign;