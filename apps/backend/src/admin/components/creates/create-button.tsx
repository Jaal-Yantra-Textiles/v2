import { Button } from "@medusajs/ui";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

const CreateButton = () => {
  const { t } = useTranslation();

  return (
    <Button size="small" variant="secondary" asChild>
      <Link to="create">{t("Create")}</Link>
    </Button>
  );
};

export default CreateButton;
