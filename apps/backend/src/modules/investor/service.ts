import { MedusaService } from "@medusajs/framework/utils"
import Investor from "./models/investor"
import InvestorAdmin from "./models/investor-admin"
import CapTable from "./models/cap-table"
import ShareClass from "./models/share-class"
import Stake from "./models/stake"
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
  FundingRound,
  Pipeline,
  CallForShares,
  Payment,
  Document,
}) {
  constructor() {
    super(...arguments)
  }
}

export default InvestorService
