import { Module } from "@medusajs/framework/utils";
import Fullfilled_ordersService from "./service";

export const FULLFILLED_ORDERS_MODULE = "fullfilled_orders";

const Fullfilled_ordersModule = Module(FULLFILLED_ORDERS_MODULE, {
  service: Fullfilled_ordersService,
});

export default Fullfilled_ordersModule;
