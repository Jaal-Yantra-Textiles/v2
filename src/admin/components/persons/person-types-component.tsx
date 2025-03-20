import { Container, Text } from "@medusajs/ui";
import { useTranslation } from "react-i18next";
import { AdminPersonType } from "../../hooks/api/personandtype";
import { Plus } from "@medusajs/icons";
import { ActionMenu } from "../common/action-menu";

type PersonTypesComponentProps = {
  personTypes?: AdminPersonType[] | AdminPersonType;
  personId?: string;
};

export const PersonTypesComponent = ({
  personTypes,
}: PersonTypesComponentProps) => {
  const { t } = useTranslation();
  
 

  return (
    <Container className="p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Text size="base" weight="plus">
          {t("sections.personTypes", "Person Types")}
        </Text>
        <ActionMenu
          groups={[
            {
              actions: [
                {
                  label: t("actions.addPersonType", "Add Person Type"),
                  icon: <Plus />,
                  to: 'add-types',
                },
              ],
            },
          ]}
        />
      </div>
      
      {personTypes ? (
        // Handle both array and single object cases
        Array.isArray(personTypes) ? (
          // If it's an array with items
          personTypes.length > 0 ? (
            // Map over the array of person types
            personTypes.map((type: AdminPersonType) => (
              <div key={type.id} className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4 border-t border-ui-border-base">
                <Text size="small" leading="compact" weight="plus">
                  {type.name}
                </Text>
                <Text size="small" leading="compact">
                  {type.description || "-"}
                </Text>
              </div>
            ))
          ) : (
            // Empty array case
            <div className="text-ui-fg-subtle px-6 py-8 border-t border-ui-border-base text-center">
              <Text size="small" leading="compact" className="text-ui-fg-subtle">
                {t("messages.noPersonTypes", "No person types exist for this person")}
              </Text>
            </div>
          )
        ) : (
          // Handle single object case
          <div key={personTypes.id} className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4 border-t border-ui-border-base">
            <Text size="small" leading="compact" weight="plus">
              {personTypes.name}
            </Text>
            <Text size="small" leading="compact">
              {personTypes.description || "-"}
            </Text>
          </div>
        )
      ) : (
        // null or undefined case
        <div className="text-ui-fg-subtle px-6 py-8 border-t border-ui-border-base text-center">
          <Text size="small" leading="compact" className="text-ui-fg-subtle">
            {t("messages.noPersonTypes", "No person types exist for this person")}
          </Text>
        </div>
      )}
    </Container>
  );
};

export default PersonTypesComponent;
