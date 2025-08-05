'use client';

import { useState } from "react";
import { Heading, Text, Button, Checkbox } from "@medusajs/ui";
import { OnboardingModal } from "../onboarding/onboarding-modal";

const ActivityList = [
  {
    title: "Add your details",
    description: "Fill out your company profile and contact information.",
    isComplete: false, // This can be dynamic later
  },
  {
    title: "Add your people and their types",
    description: "Invite your team members and assign them roles.",
    isComplete: false,
  },
  {
    title: "Learn how to get tasks",
    description: "Understand the workflow and how to receive and manage tasks.",
    isComplete: false,
  },
];

const Setup = ({ partnerId }: { partnerId: string }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <div className="flex w-full justify-center">
      <div className="w-full max-w-2xl rounded-lg border bg-ui-bg-base p-8">
        <div className="flex flex-col items-center gap-y-2">
          <Heading level="h2">You are new here, but let&apos;s get you started!</Heading>
          <Text className="text-ui-fg-subtle">
            Complete the following steps to get your account up and running.
          </Text>
        </div>
        <div className="mt-8">
          <ul className="flex flex-col gap-y-4">
            {ActivityList.map((activity, index) => (
              <li key={index} className="flex items-start gap-x-4">
                <Checkbox 
                  checked={activity.isComplete}
                  onCheckedChange={() => {}}
                  className="mt-1"
                />
                <div>
                  <Text weight="plus" size="large" className="text-ui-fg-base">
                    {activity.title}
                  </Text>
                  <Text className="text-ui-fg-subtle">{activity.description}</Text>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-8 flex justify-center">
          <Button size="base" onClick={() => setIsModalOpen(true)}>
            Start Onboarding
          </Button>
        </div>
      </div>
      
      <OnboardingModal 
        partnerId={partnerId} 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
      />
    </div>
  );
};

export default Setup;
