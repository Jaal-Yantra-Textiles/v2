import { AwilixContainer } from "awilix";
import { DESIGN_MODULE } from "../../../modules/designs";
import DesignService from "../../../modules/designs/service";
import { Design } from "./validators";

export type DesignAllowedFields = "*" | keyof Design;

export const refetchDesign = async (
  designId: string,
  container: AwilixContainer,
  fields: DesignAllowedFields[] = ["*"]
) => {
  const designService: DesignService = container.resolve(DESIGN_MODULE);
  return await designService.retrieveDesign(designId);
};
