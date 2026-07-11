import { MedusaService } from "@medusajs/framework/utils"
import Investor from "./models/investor"
import InvestorAdmin from "./models/investor-admin"
import CapTable from "./models/cap-table"
import ShareClass from "./models/share-class"
import Stake from "./models/stake"
import Convertible from "./models/convertible"
import CompanyExpense from "./models/company-expense"
import FundingRound from "./models/funding-round"
import Pipeline from "./models/pipeline"
import CallForShares from "./models/call-for-shares"
import Payment from "./models/payment"
import Document from "./models/document"

class InvestorService extends MedusaService({
  Investor,
  InvestorAdmin,
  CapTable,
  ShareClass,
  Stake,
  Convertible,
  CompanyExpense,
  FundingRound,
  Pipeline,
  CallForShares,
  Payment,
  Document,
}) {
  constructor() {
    super(...arguments)
  }

  // --- query.graph aliases -------------------------------------------------
  // Remote query (query.graph) addresses an entity by its `model.define()`
  // name — investor_pipeline / investor_document / investor_payment — and so
  // resolves the module's `list<DefineName>` / `listAndCount<DefineName>`
  // method. Our MedusaService keys are the shorter Pipeline/Document/Payment,
  // which only generate listPipelines/listDocuments/listPayments. Bridge the
  // names here so `query.graph({ entity: "investor_pipeline" })` (and friends)
  // resolve instead of throwing `Method "listInvestorPipelines" does not exist`.
  async listInvestorPipelines(...args: any[]) {
    return (this as any).listPipelines(...args)
  }
  async listAndCountInvestorPipelines(...args: any[]) {
    return (this as any).listAndCountPipelines(...args)
  }
  async listInvestorDocuments(...args: any[]) {
    return (this as any).listDocuments(...args)
  }
  async listAndCountInvestorDocuments(...args: any[]) {
    return (this as any).listAndCountDocuments(...args)
  }
  async listInvestorPayments(...args: any[]) {
    return (this as any).listPayments(...args)
  }
  async listAndCountInvestorPayments(...args: any[]) {
    return (this as any).listAndCountPayments(...args)
  }
}

export default InvestorService
