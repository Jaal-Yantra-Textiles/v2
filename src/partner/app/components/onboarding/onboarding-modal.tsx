'use client';

import { useMemo, useState } from 'react';
import {
  Button,
  FocusModal,
  ProgressTabs,
  Input,
  Text,
  Heading,
  Alert
} from '@medusajs/ui';
import { z } from 'zod';

interface Person {
  first_name: string;
  last_name: string;
  email: string;
}

const personSchema = z.object({
  first_name: z.string().min(1, 'First name is required'),
  last_name: z.string().min(1, 'Last name is required'),
  email: z.string().email('Invalid email address'),
});

interface OnboardingModalProps {
  partnerId: string;
  isOpen: boolean;
  onClose: () => void;
}

export function OnboardingModal({ partnerId, isOpen, onClose }: OnboardingModalProps) {
  const [currentStep, setCurrentStep] = useState('logo');
  const [logo, setLogo] = useState<File | null>(null);
  const [people, setPeople] = useState<Person[]>([
    { first_name: '', last_name: '', email: '' }
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const storageKey = useMemo(() => {
    return partnerId ? `partner_onboarding_${partnerId}` : null
  }, [partnerId])

  const persistState = (patch: Record<string, unknown>) => {
    if (!storageKey) {
      return
    }
    try {
      const raw = localStorage.getItem(storageKey)
      const existing = raw ? JSON.parse(raw) : {}
      localStorage.setItem(storageKey, JSON.stringify({ ...existing, ...patch }))
    } catch {
      localStorage.setItem(storageKey, JSON.stringify({ ...patch }))
    }
  }

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setLogo(e.target.files[0]);
    }
  };

  const handleSkip = () => {
    persistState({ skipped: true, completed: false, skipped_at: new Date().toISOString() })
    onClose()
  }

  const handlePersonChange = (index: number, field: keyof Person, value: string) => {
    const updatedPeople = [...people];
    updatedPeople[index] = { ...updatedPeople[index], [field]: value };
    setPeople(updatedPeople);
  };

  const addPerson = () => {
    setPeople([...people, { first_name: '', last_name: '', email: '' }]);
  };

  const removePerson = (index: number) => {
    if (people.length > 1) {
      const updatedPeople = [...people];
      updatedPeople.splice(index, 1);
      setPeople(updatedPeople);
    }
  };

  const validatePeople = () => {
    for (const person of people) {
      const result = personSchema.safeParse(person);
      if (!result.success) {
        const firstError = result.error.errors[0];
        setError(`${firstError.path.join('.')} - ${firstError.message}`);
        return false;
      }
    }
    return true;
  };

  const handleSubmit = async () => {
    if (!validatePeople()) return;
    
    setIsSubmitting(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/partners/${partnerId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ people }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to submit onboarding data');
      }

      persistState({ completed: true, skipped: false, completed_at: new Date().toISOString() })
      
      setSuccess(true);
      setTimeout(() => {
        onClose();
        window.location.reload();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  const steps = [
    {
      id: 'logo',
      label: 'Upload Logo',
      description: 'Add your company logo',
    },
    {
      id: 'people',
      label: 'Add People',
      description: 'Add your team members',
    },
  ];

  return (
    <FocusModal open={isOpen} onOpenChange={(open) => (!open ? onClose() : null)}>
      <FocusModal.Content className="max-w-2xl w-full mx-auto my-8">
        <FocusModal.Header>
          <Heading>Partner Onboarding</Heading>
        </FocusModal.Header>
        <ProgressTabs value={currentStep} onValueChange={setCurrentStep}>
          <ProgressTabs.List className='border-b'>
            {steps.map((step) => (
              <ProgressTabs.Trigger key={step.id} value={step.id}>
                {step.label}
              </ProgressTabs.Trigger>
            ))}
          </ProgressTabs.List>
          <FocusModal.Body className="size-full overflow-hidden">
            <ProgressTabs.Content value="logo" className="p-6 h-full">
              <div className="flex flex-col gap-y-4 min-h-[300px]">
                <Text size="large" weight="plus">Upload your company logo</Text>
                <div className="flex items-center justify-center w-full flex-grow">
                  <label className="flex flex-col items-center justify-center w-full h-64 border-2 border-dashed rounded-lg cursor-pointer bg-ui-bg-subtle hover:bg-ui-bg-base-pressed">
                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                      <Text size="small" className="text-ui-fg-subtle mb-2">
                        {logo ? logo.name : 'Click to upload or drag and drop'}
                      </Text>
                      <Text size="small" className="text-ui-fg-muted">
                        SVG, PNG, JPG (MAX. 5MB)
                      </Text>
                    </div>
                    <input 
                      type="file" 
                      className="hidden" 
                      accept="image/*" 
                      onChange={handleLogoChange}
                    />
                  </label>
                </div>
              </div>
            </ProgressTabs.Content>
            <ProgressTabs.Content value="people" className="p-6 h-full">
              <div className="flex flex-col gap-y-4 min-h-[300px]">
                <Text size="large" weight="plus">Add your team members</Text>
                {error && (
                  <Alert variant="error">{error}</Alert>
                )}
                {success && (
                  <Alert variant="success">Onboarding completed successfully!</Alert>
                )}
                <div className="space-y-4 flex-grow">
                  {people.map((person, index) => (
                    <div key={index} className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 border rounded-lg">
                      <div>
                        <Text size="small" className="block mb-1">First Name</Text>
                        <Input
                          value={person.first_name}
                          onChange={(e) => handlePersonChange(index, 'first_name', e.target.value)}
                          placeholder="John"
                        />
                      </div>
                      <div>
                        <Text size="small" className="block mb-1">Last Name</Text>
                        <Input
                          value={person.last_name}
                          onChange={(e) => handlePersonChange(index, 'last_name', e.target.value)}
                          placeholder="Doe"
                        />
                      </div>
                      <div>
                        <Text size="small" className="block mb-1">Email</Text>
                        <Input
                          value={person.email}
                          onChange={(e) => handlePersonChange(index, 'email', e.target.value)}
                          placeholder="john@company.com"
                          type="email"
                        />
                      </div>
                      {people.length > 1 && (
                        <div className="md:col-span-3 flex justify-end">
                          <Button 
                            variant="danger" 
                            size="small" 
                            onClick={() => removePerson(index)}
                          >
                            Remove
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <Button variant="secondary" onClick={addPerson} className="w-full mt-2">
                  + Add Another Person
                </Button>
              </div>
            </ProgressTabs.Content>
          </FocusModal.Body>
          <FocusModal.Footer>
            <div className="flex items-center justify-end gap-2 w-full">
              <Button variant="secondary" onClick={handleSkip}>
                Skip
              </Button>
              {currentStep === 'logo' ? (
                <Button onClick={() => setCurrentStep('people')}>
                  Next
                </Button>
              ) : (
                <>
                  <Button variant="secondary" onClick={() => setCurrentStep('logo')}>
                    Back
                  </Button>
                  <Button 
                    onClick={handleSubmit} 
                    isLoading={isSubmitting}
                    disabled={isSubmitting}
                  >
                    Complete Onboarding
                  </Button>
                </>
              )}
            </div>
          </FocusModal.Footer>
        </ProgressTabs>
      </FocusModal.Content>
    </FocusModal>
  );
}
