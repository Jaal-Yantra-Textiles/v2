import { useState, useEffect } from "react";
import { CreateDesignAIComponent } from "../../../components/designs/create-design-ai-component";
import { CreateManualDesign } from "../../../components/designs/create-manual-design";
import { useNavigate } from "react-router-dom";
import { usePrompt } from "@medusajs/ui";
import { RouteFocusModal } from "../../../components/modal/route-focus-modal";

const CreateDesignPage = () => {
  const [designMode, setDesignMode] = useState<'ai' | 'manual' | null>(null);
  const navigate = useNavigate();
  const dialog = usePrompt();
  
  // Show the prompt dialog when the component mounts
  useEffect(() => {
    showDesignModePrompt();
  }, []);
  
  const showDesignModePrompt = async () => {
    const useAI = await dialog({
      title: "Choose your designing path",
      description: "Would you like to use AI to generate your design?",
      confirmText: "Use AI",
      cancelText: "Design manually",
      variant: "confirmation"
    });
    
    if (useAI) {
      setDesignMode('ai');
    } else {
      setDesignMode('manual');
    }
  };
  
  
  const handleManualSave = () => {
    console.log("Manual design saved");
    // Save the manual design
    // Then navigate to the new design or designs list
    navigate("/designs");
  };
  
  // Render the appropriate component based on design mode
  return (
    <div>
      {designMode === 'ai' && (
        <CreateDesignAIComponent />
      )}
      {designMode === 'manual' && (
        <CreateManualDesign onSave={handleManualSave} />
      )}
    </div>
  );
};

export default CreateDesignPage;