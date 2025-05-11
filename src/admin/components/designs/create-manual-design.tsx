import { useState, useEffect, useCallback } from "react";
import { RouteFocusModal } from "../modal/route-focus-modal";
import { Button, Heading, Text, Input, Textarea, toast, Prompt } from "@medusajs/ui";
import { KeyboundForm } from "../utilitites/key-bound-form";
import { useCreateDesign } from "../../hooks/api/designs";
import { useNavigate, useBlocker } from "react-router-dom";
import { useTranslation } from "react-i18next";

interface CreateManualDesignProps {
  onSave?: () => void;
}

export function CreateManualDesign({ onSave }: CreateManualDesignProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [showCloseConfirmation, setShowCloseConfirmation] = useState(false);
  const [nameError, setNameError] = useState("");
  const [descriptionError, setDescriptionError] = useState("");
  
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { mutateAsync, isPending } = useCreateDesign();
  
  // Track form changes
  useEffect(() => {
    if (name || description) {
      setIsDirty(true);
    }
    
    // Clear validation errors when fields are filled
    if (name) setNameError("");
    if (description) setDescriptionError("");
  }, [name, description]);
  
  // Use the router blocker to prevent navigation when form is dirty
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    // Only block if the form is dirty and we're navigating away
    const isPathChanged = currentLocation.pathname !== nextLocation.pathname;
    const ret = isDirty && isPathChanged;

    if (!ret) {
      // If we're not blocking, reset the confirmation dialog
      setShowCloseConfirmation(false);
    }

    return ret;
  });

  // Handle blocker actions
  const handleCancel = () => {
    blocker?.reset?.();
  };

  const handleContinue = () => {
    blocker?.proceed?.();
  };

  // Handle escape key press
  const handleEscapeKey = useCallback((event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (isDirty) {
        setShowCloseConfirmation(true);
      } else {
        navigate(-1);
      }
    }
  }, [isDirty, navigate]);
  
  // Add and remove escape key listener
  useEffect(() => {
    document.addEventListener("keydown", handleEscapeKey);
    return () => {
      document.removeEventListener("keydown", handleEscapeKey);
    };
  }, [handleEscapeKey]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate form fields
    let hasErrors = false;
    
    if (!name) {
      setNameError("Name is required");
      hasErrors = true;
    }
    
    if (!description) {
      setDescriptionError("Description is required");
      hasErrors = true;
    }
    
    if (hasErrors) {
      return;
    }
    
    try {
      await mutateAsync(
        {
          name,
          description,
          status: "Conceptual",
          target_completion_date: new Date().toISOString(),
        },
        {
          onSuccess: ({ design }) => {
            toast.success(`Design ${design.name} created successfully`);
            if (onSave) {
              onSave();
            } else {
              navigate(`/designs/${design.id}`);
            }
          },
          onError: (error) => {
            toast.error(error.message || "Failed to create design");
          },
        }
      );
    } catch (error: any) {
      toast.error(error.message || "An unexpected error occurred");
    }
  }
  return (
    <RouteFocusModal>
      <KeyboundForm
              onSubmit={handleSubmit}
              className="flex flex-1 flex-col overflow-hidden"
            >
      <RouteFocusModal.Header />
      <RouteFocusModal.Close asChild>
        <button
          onClick={(e) => {
            e.preventDefault();
            if (isDirty) {
              setShowCloseConfirmation(true);
            } else {
              navigate(-1);
            }
          }}
        />
      </RouteFocusModal.Close>
      <RouteFocusModal.Body className="flex flex-1 flex-col items-center overflow-y-auto py-16">
        <div className="flex w-full max-w-[720px] flex-col gap-y-8">
          <div>
            <Heading>Create Design Manually</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              Create a new design from scratch
            </Text>
          </div>
          
          <div className="flex flex-col gap-y-4">
            <div className="flex flex-col gap-y-2">
              <Text size="base" weight="plus">Name</Text>
              <Input 
                placeholder="Enter design name" 
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={`w-full ${nameError ? 'border-ui-error' : ''}`}
              />
              {nameError && (
                <Text size="small" className="text-ui-error mt-1">{nameError}</Text>
              )}
            </div>
            
            <div className="flex flex-col gap-y-2">
              <Text size="base" weight="plus">Description</Text>
              <Textarea 
                placeholder="Enter design description" 
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                className={`w-full ${descriptionError ? 'border-ui-error' : ''}`}
              />
              {descriptionError && (
                <Text size="small" className="text-ui-error mt-1">{descriptionError}</Text>
              )}
            </div>
          </div>
        </div>
      </RouteFocusModal.Body>
      
      <RouteFocusModal.Footer>
        <div className="flex justify-end items-center gap-x-2 px-6">
          <Button 
            variant="secondary"
            onClick={() => {
              if (isDirty) {
                setShowCloseConfirmation(true);
              } else {
                navigate(-1);
              }
            }}
          >
            Close
          </Button>
          
          <Button 
            variant="primary"
            onClick={handleSubmit}
            isLoading={isPending}
            disabled={!name || !description || isPending}
          >
            Save
          </Button>
        </div>
      </RouteFocusModal.Footer>
      </KeyboundForm>
      
      {/* Unsaved changes confirmation prompt - for manual close actions */}
      <Prompt open={showCloseConfirmation} variant="confirmation">
        <Prompt.Content>
          <Prompt.Header>
            <Prompt.Title>{t("general.unsavedChangesTitle", "Unsaved Changes")}</Prompt.Title>
            <Prompt.Description>
              {t("general.unsavedChangesDescription", "You have unsaved changes. Are you sure you want to leave?")}  
            </Prompt.Description>
          </Prompt.Header>
          <Prompt.Footer>
            <Prompt.Cancel 
              onClick={() => setShowCloseConfirmation(false)} 
              type="button"
            >
              {t("actions.cancel", "Cancel")}
            </Prompt.Cancel>
            <Prompt.Action 
              onClick={() => {
                setShowCloseConfirmation(false);
                navigate(-1);
              }} 
              type="button"
            >
              {t("actions.continue", "Continue")}
            </Prompt.Action>
          </Prompt.Footer>
        </Prompt.Content>
      </Prompt>
      
      {/* Router blocker prompt - for navigation events */}
      <Prompt open={blocker.state === "blocked"} variant="confirmation">
        <Prompt.Content>
          <Prompt.Header>
            <Prompt.Title>{t("general.unsavedChangesTitle", "Unsaved Changes")}</Prompt.Title>
            <Prompt.Description>
              {t("general.unsavedChangesDescription", "You have unsaved changes. Are you sure you want to leave?")}  
            </Prompt.Description>
          </Prompt.Header>
          <Prompt.Footer>
            <Prompt.Cancel onClick={handleCancel} type="button">
              {t("actions.cancel", "Cancel")}
            </Prompt.Cancel>
            <Prompt.Action onClick={handleContinue} type="button">
              {t("actions.continue", "Continue")}
            </Prompt.Action>
          </Prompt.Footer>
        </Prompt.Content>
      </Prompt>
    </RouteFocusModal>
  );
}