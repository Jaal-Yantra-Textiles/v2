import {useParams} from 'react-router-dom'
import { DesignMoodboardSection } from '../../../../components/designs/design-moodboard-section';

const AddMoodBoardDocument = () => {
    const { id } = useParams()
  return (
    
    <DesignMoodboardSection />
  );
};

export default AddMoodBoardDocument;