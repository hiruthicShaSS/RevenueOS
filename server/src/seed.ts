import { getDb } from "./db.js";
import { memory } from "./memory/index.js";
import { errMsg } from "./memory/hindsightStore.js";
import { retainInteraction } from "./services/ingest.js";
import { ensurePlaybookModel, recordPlaybookLesson } from "./services/playbook.js";
import { id, isoDate } from "./util.js";

export const DEMO_CUSTOMER_ID = "cus_halcyon";

const daysAgo = (n: number) => new Date(Date.now() - n * 864e5);
const daysAhead = (n: number) => isoDate(new Date(Date.now() + n * 864e5));

const REPS = [
  ["rep_priya", "Priya Nair", "Senior Account Executive", "priya.nair@revenueos.app"],
  ["rep_marcus", "Marcus Chen", "Account Executive", "marcus.chen@revenueos.app"],
  ["rep_jordan", "Jordan Blake", "Enterprise Account Executive", "jordan.blake@revenueos.app"],
  ["rep_elena", "Elena Rossi", "Solutions Engineer", "elena.rossi@revenueos.app"],
];

const CUSTOMERS = [
  [DEMO_CUSTOMER_ID, "Halcyon Logistics", "Logistics & 3PL", 2400, "Chicago, IL", "halcyonlogistics.com", "Regional 3PL running 14 cross-dock facilities on SAP S/4HANA. Evaluating us to replace spreadsheet-based shipment exception tracking."],
  ["cus_meridian", "Meridian Health Partners", "Healthcare", 11000, "Nashville, TN", "meridianhp.org", "Hospital network with 9 facilities. Wants supply-chain visibility for medical consumables."],
  ["cus_brightwater", "Brightwater Foods", "Food manufacturing", 3100, "Minneapolis, MN", "brightwaterfoods.com", "Frozen and chilled foods producer, cold-chain compliance is a board-level topic."],
  ["cus_kestrel", "Kestrel Aerospace Components", "Aerospace manufacturing", 1800, "Wichita, KS", "kestrelaero.com", "Tier-2 supplier of machined structural parts; long, engineering-led buying process."],
  ["cus_solace", "Solace Insurance Group", "Insurance", 6500, "Hartford, CT", "solaceinsurance.com", "Commercial lines insurer; buying for their claims logistics and salvage operations."],
  ["cus_pinecrest", "Pinecrest Credit Union", "Financial services", 900, "Boise, ID", "pinecrestcu.org", "Member-owned credit union consolidating branch supply ordering."],
  ["cus_tidewater", "Tidewater Energy Services", "Energy", 4200, "Houston, TX", "tidewaterenergy.com", "Oilfield services firm with remote-site equipment logistics."],
  ["cus_vantage", "Vantage Outdoor Retail", "Retail", 2700, "Denver, CO", "vantageoutdoor.com", "Outdoor gear retailer, 64 stores, went live with us last quarter."],
  ["cus_larkspur", "Larkspur Biologics", "Life sciences", 650, "San Diego, CA", "larkspurbio.com", "Clinical-stage biotech; evaluated us for clinical trial supply shipments."],
] as const;

// [id, customer, name, amount, stage, probability, closeInDays, owner, status, risk, blocker]
const DEALS = [
  ["deal_halcyon", DEMO_CUSTOMER_ID, "Network Visibility Platform — 3-year", 186000, "Negotiation", 55, 23, "rep_priya", "open", "medium", null],
  ["deal_meridian", "cus_meridian", "Consumables Visibility — 9 facilities", 420000, "Proposal", 40, 45, "rep_marcus", "open", "high", "HIPAA security review and BAA"],
  ["deal_brightwater", "cus_brightwater", "Cold-Chain Compliance Suite", 138000, "Negotiation", 70, 12, "rep_priya", "open", "low", "Procurement calendar"],
  ["deal_kestrel", "cus_kestrel", "Supplier Shipment Tracking", 264000, "Qualification", 25, 75, "rep_marcus", "open", "medium", null],
  ["deal_solace", "cus_solace", "Claims Logistics Platform", 310000, "Negotiation", 60, 30, "rep_jordan", "open", "high", "Competing bid from incumbent vendor"],
  ["deal_pinecrest", "cus_pinecrest", "Branch Supply Ordering", 72000, "Proposal", 50, 20, "rep_jordan", "open", "low", null],
  ["deal_tidewater", "cus_tidewater", "Remote Site Equipment Logistics", 205000, "Discovery", 15, 90, "rep_marcus", "open", "low", null],
  ["deal_vantage", "cus_vantage", "Store Replenishment Visibility", 96000, "Closed Won", 100, -40, "rep_priya", "won", "low", "Implementation timeline"],
  ["deal_larkspur", "cus_larkspur", "Clinical Supply Tracking", 158000, "Closed Lost", 0, -25, "rep_jordan", "lost", "low", "Budget freeze"],
] as const;

// Historical interactions for non-demo accounts: [customer, rep, kind, daysAgo, text]
const HISTORY = [
  ["cus_meridian", "rep_marcus", "meeting", 34, "Discovery workshop with Meridian. Angela Ruiz (VP Supply Chain) wants one view of consumables across all 9 hospitals; stockouts of IV sets cost them two elective surgery delays last quarter. Tom Becker (CISO) joined late and said nothing moves until we pass their vendor security assessment and sign a BAA."],
  ["cus_meridian", "rep_marcus", "email", 19, "Tom Becker sent Meridian's 212-question security questionnaire. He flagged that our SOC 2 Type II report is 14 months old and asked for the bridge letter. I committed to return the completed questionnaire and bridge letter within 10 business days."],
  ["cus_meridian", "rep_elena", "call", 6, "Technical call with Meridian IT. They use Epic and Workday; integration through Workday Supply Chain is a must. Angela is pushing internally but procurement will not issue the PO until security signs off. Tom has not acknowledged our questionnaire responses yet."],
  ["cus_brightwater", "rep_priya", "meeting", 27, "Met Brightwater's ops leadership. Karen Lindqvist (COO) is the champion — failed FDA cold-chain audit at their Mankato plant is the trigger. Budget approved at $140k. Legal redlines expected next week."],
  ["cus_brightwater", "rep_priya", "email", 9, "Brightwater legal returned redlines: liability cap at 12 months fees and a data residency clause (US only). Both acceptable. Karen says the PO goes to the board finance committee on the 18th."],
  ["cus_solace", "rep_jordan", "meeting", 22, "Solace salvage ops team demo. Raj Malhotra (Director, Claims Ops) liked the exception workflow. They currently use LogiTrack, contract renews in January; LogiTrack offered a 30% renewal discount to keep them."],
  ["cus_solace", "rep_jordan", "call", 11, "Raj said finance (Diane Foster, CFO) is anchored on LogiTrack's discounted price. I offered 10% off year one; Diane rejected it, said switching cost is the real concern, not license price. I promised a migration cost analysis within two weeks."],
  ["cus_kestrel", "rep_marcus", "call", 16, "Intro call with Kestrel's logistics manager, Ben Okafor. They track supplier shipments by email and a shared Excel sheet. Engineering-led buying: quality team must validate data accuracy before anything goes to budget."],
  ["cus_pinecrest", "rep_jordan", "meeting", 13, "Pinecrest ops review with Lisa Tran (VP Operations). 28 branches order supplies independently. They want approval workflows and a simple UI; price sensitivity is real — board caps new software at $75k/yr."],
  ["cus_tidewater", "rep_marcus", "call", 41, "First call with Tidewater. Carlos Mendes (Logistics Lead) manages equipment moves to 30 remote sites. Interested but no budget until next fiscal year in April."],
] as const;

const STAKEHOLDERS = [
  ["cus_meridian", "Angela Ruiz", "VP Supply Chain", "champion", "Stop consumables stockouts"],
  ["cus_meridian", "Tom Becker", "CISO", "blocker", "Security assessment and BAA before any PO"],
  ["cus_brightwater", "Karen Lindqvist", "COO", "champion", "Pass the next FDA cold-chain audit"],
  ["cus_solace", "Raj Malhotra", "Director, Claims Ops", "supporter", "Faster salvage exception handling"],
  ["cus_solace", "Diane Foster", "CFO", "skeptic", "Total switching cost vs incumbent"],
  ["cus_kestrel", "Ben Okafor", "Logistics Manager", "neutral", "Replace email and Excel tracking"],
  ["cus_pinecrest", "Lisa Tran", "VP Operations", "supporter", "Branch approval workflows under $75k/yr"],
  ["cus_tidewater", "Carlos Mendes", "Logistics Lead", "neutral", "Remote site equipment moves"],
] as const;

// [customer, owner, promisedTo, description, dueOffsetDays, status]
const COMMITMENTS = [
  ["cus_meridian", "Marcus Chen", "Tom Becker", "Return completed security questionnaire and SOC 2 bridge letter", -5, "open"],
  ["cus_solace", "Jordan Blake", "Diane Foster", "Send migration cost analysis vs LogiTrack", 3, "open"],
  ["cus_brightwater", "Priya Nair", "Karen Lindqvist", "Send countersigned redlines before finance committee", 4, "open"],
  ["cus_pinecrest", "Jordan Blake", "Lisa Tran", "Share approval-workflow demo recording", -2, "open"],
  ["cus_brightwater", "Priya Nair", "Karen Lindqvist", "Provide FDA audit trail sample report", -12, "done"],
] as const;

const OBJECTIONS = [
  ["cus_meridian", "security", "Vendor security assessment and BAA required before PO", "Tom Becker"],
  ["cus_meridian", "integration", "Must integrate with Workday Supply Chain", "Meridian IT"],
  ["cus_solace", "competition", "Incumbent LogiTrack offered 30% renewal discount", "Raj Malhotra"],
  ["cus_solace", "implementation", "Switching cost and migration risk", "Diane Foster"],
  ["cus_pinecrest", "pricing", "Board caps new software at $75k/yr", "Lisa Tran"],
  ["cus_kestrel", "authority", "Quality team must validate data accuracy before budget", "Ben Okafor"],
] as const;

const OFFERS = [["cus_solace", "10% discount on year one", 10, "rejected"]] as const;

/** Anonymised lessons from past deals: what the playbook bank learns from. */
const LESSONS = [
  { industry: "Logistics & 3PL", employees: 1900, amount: 172000, blocker: "SAP ERP integration and implementation risk", tactics: "Offered 15% then 25% discount; integration questions answered by email only", outcome: "lost" as const, reason: "Customer chose a competitor with a prebuilt SAP connector. Discounts never addressed the integration fear.", days: 160 },
  { industry: "Food manufacturing", employees: 2600, amount: 148000, blocker: "Oracle ERP integration", tactics: "Solutions engineer led a technical deep-dive, written implementation plan, 2-week pilot on one plant. No discount.", outcome: "won" as const, reason: "Pilot proved the integration; CFO signed at list price.", days: 140 },
  { industry: "Retail", employees: 2700, amount: 96000, blocker: "Implementation timeline", tactics: "Phased rollout plan (5 stores first), named implementation lead, reference call with a similar retailer", outcome: "won" as const, reason: "Phasing de-risked go-live; reference call closed it.", days: 40 },
  { industry: "Healthcare", employees: 8000, amount: 380000, blocker: "Security review", tactics: "First offered 10% discount (stalled 6 weeks), then delivered SOC 2 report, pen-test summary and signed BAA within 5 days", outcome: "won" as const, reason: "Discount did nothing; speed on security paperwork unlocked the PO.", days: 120 },
  { industry: "Life sciences", employees: 650, amount: 158000, blocker: "Budget freeze", tactics: "20% end-of-quarter discount", outcome: "lost" as const, reason: "Budget was frozen; no price would have worked. Should have proposed a start date in the next fiscal year.", days: 25 },
  { industry: "Logistics & 3PL", employees: 3200, amount: 210000, blocker: "Implementation confidence", tactics: "Promised integration documentation, delivered it 3 weeks late; then offered 20% discount", outcome: "lost" as const, reason: "Customer said the late documentation made them doubt we could hit a 30-day go-live. Trust was lost before pricing mattered.", days: 90 },
  { industry: "Financial services", employees: 1200, amount: 88000, blocker: "Pricing (hard budget cap)", tactics: "3-year term with 12% discount to fit under the cap", outcome: "won" as const, reason: "Price really was the constraint; multi-year structure fit the cap.", days: 70 },
  { industry: "Manufacturing", employees: 2100, amount: 236000, blocker: "SAP synchronization", tactics: "Live demo of automated SAP sync in a sandbox with their CTO, 30-day implementation plan with weekly milestones", outcome: "won" as const, reason: "CTO saw the sync working on realistic data; the milestone plan answered the timeline concern.", days: 55 },
];

export async function seedDatabase({ force = false } = {}) {
  const db = await getDb();
  const [{ n }] = await db.query(`SELECT count(*)::int AS n FROM customers`);
  if (n > 0 && !force) {
    // Databases seeded before sign-in existed: give the seeded teammates their emails.
    for (const [rid, , , email] of REPS) await db.query(`UPDATE reps SET email=$2 WHERE id=$1 AND email IS NULL`, [rid, email]);
    return { seeded: false };
  }
  if (force) {
    await db.exec(`TRUNCATE commitments, objections, offers, interactions, stakeholders, deals, customers, reps CASCADE;`);
  }

  for (const [rid, name, title, email] of REPS) await db.query(`INSERT INTO reps (id, name, title, email) VALUES ($1,$2,$3,$4)`, [rid, name, title, email]);
  for (const [cid, name, industry, emp, hq, web, summary] of CUSTOMERS) {
    await db.query(`INSERT INTO customers (id, name, industry, employees, hq, website, summary) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [cid, name, industry, emp, hq, web, summary]);
  }
  for (const [did, cid, name, amount, stage, prob, closeIn, owner, status, risk, blocker] of DEALS) {
    await db.query(
      `INSERT INTO deals (id, customer_id, name, amount, stage, probability, close_date, owner_id, status, risk, primary_blocker)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [did, cid, name, amount, stage, prob, daysAhead(closeIn), owner, status, risk, blocker]
    );
  }
  for (const [cid, rid, kind, ago, text] of HISTORY) {
    await db.query(
      `INSERT INTO interactions (id, customer_id, rep_id, kind, occurred_at, raw_text, memory_status) VALUES ($1,$2,$3,$4,$5,$6,'pending')`,
      [id("int"), cid, rid, kind, daysAgo(ago).toISOString(), text]
    );
  }
  for (const [cid, name, role, stance, pri] of STAKEHOLDERS) {
    await db.query(`INSERT INTO stakeholders (id, customer_id, name, role, stance, priorities) VALUES ($1,$2,$3,$4,$5,$6)`, [id("stk"), cid, name, role, stance, pri]);
  }
  for (const [cid, owner, to, desc, due, status] of COMMITMENTS) {
    await db.query(
      `INSERT INTO commitments (id, customer_id, owner, promised_to, description, due_date, status, completed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id("cmt"), cid, owner, to, desc, daysAhead(due), status, status === "done" ? new Date().toISOString() : null]
    );
  }
  for (const [cid, cat, desc, by] of OBJECTIONS) {
    await db.query(`INSERT INTO objections (id, customer_id, category, description, raised_by) VALUES ($1,$2,$3,$4,$5)`, [id("obj"), cid, cat, desc, by]);
  }
  for (const [cid, desc, pct, resp] of OFFERS) {
    await db.query(`INSERT INTO offers (id, customer_id, description, discount_pct, response) VALUES ($1,$2,$3,$4,$5)`, [id("off"), cid, desc, pct, resp]);
  }
  return { seeded: true };
}

/** Writes seeded history + playbook lessons into Hindsight. Safe to re-run (document ids make it idempotent). */
export async function seedMemory(log: (s: string) => void = console.log) {
  const db = await getDb();
  const rows = await db.query(
    `SELECT i.*, c.name AS customer_name, r.name AS rep_name, r.title AS rep_title
     FROM interactions i JOIN customers c ON c.id=i.customer_id JOIN reps r ON r.id=i.rep_id
     WHERE i.memory_status <> 'stored' AND i.customer_id <> $1 ORDER BY occurred_at`,
    [DEMO_CUSTOMER_ID]
  );
  const stakeholders = await db.query(`SELECT customer_id, name FROM stakeholders`);
  for (const r of rows) {
    try {
      await memory.ensureCustomerBank(r.customer_id, r.customer_name);
      await retainInteraction({
        bank: memory.customerBank(r.customer_id),
        interactionId: r.id,
        customerName: r.customer_name,
        repName: r.rep_name,
        repTitle: r.rep_title,
        kind: r.kind,
        occurredAt: new Date(r.occurred_at).toISOString(),
        text: r.raw_text,
        stakeholderNames: stakeholders.filter((s: any) => s.customer_id === r.customer_id).map((s: any) => s.name),
      });
      await db.query(`UPDATE interactions SET memory_status='stored', memory_error=NULL WHERE id=$1`, [r.id]);
      log(`  retained ${r.customer_name} ${r.kind} (${isoDate(r.occurred_at)})`);
    } catch (e) {
      await db.query(`UPDATE interactions SET memory_status='failed', memory_error=$2 WHERE id=$1`, [r.id, errMsg(e)]);
      log(`  FAILED ${r.customer_name}: ${errMsg(e)}`);
    }
  }
  for (const [i, l] of LESSONS.entries()) {
    try {
      await recordPlaybookLesson({ ...l, when: daysAgo(l.days).toISOString(), docId: `seed-lesson-${i}` });
      log(`  playbook lesson ${i + 1}/${LESSONS.length} (${l.outcome})`);
    } catch (e) {
      log(`  FAILED lesson ${i + 1}: ${errMsg(e)}`);
    }
  }
  try {
    await ensurePlaybookModel();
    log("  playbook mental model ready");
  } catch (e) {
    log(`  mental model: ${errMsg(e)}`);
  }
}

/** Puts the demo account back to "no memory": clears its CRM rows and deletes its Hindsight bank. */
export async function resetDemoAccount() {
  const db = await getDb();
  for (const t of ["commitments", "objections", "offers", "stakeholders", "interactions"]) {
    await db.query(`DELETE FROM ${t} WHERE customer_id=$1`, [DEMO_CUSTOMER_ID]);
  }
  await db.query(
    `UPDATE deals SET stage='Negotiation', probability=55, status='open', risk='medium', primary_blocker=NULL, outcome_reason=NULL, updated_at=now() WHERE customer_id=$1`,
    [DEMO_CUSTOMER_ID]
  );
  await memory.deleteBank(memory.customerBank(DEMO_CUSTOMER_ID));
}

/** The scripted demo conversations, dated relative to today so "by Friday" becomes overdue. */
export function demoScript() {
  const c1 = daysAgo(21);
  const c2 = daysAgo(7);
  return {
    customerId: DEMO_CUSTOMER_ID,
    steps: [
      {
        title: "Conversation 1 — initial negotiation",
        repId: "rep_priya",
        kind: "meeting",
        occurredAt: c1.toISOString(),
        text:
          "Had a meeting with Halcyon Logistics. Their CFO, Sarah Whitman, said the annual subscription price is too high. They are looking for a 15% discount. " +
          "Their CTO, David Okafor, mentioned that they need integration with SAP. They expect implementation to take less than 30 days. " +
          "I promised to send the integration documentation by Friday.",
      },
      {
        title: "Conversation 2 — a different rep, two weeks later",
        repId: "rep_marcus",
        kind: "call",
        occurredAt: c2.toISOString(),
        text:
          "Had another call with Halcyon Logistics. They said our 20% discount still doesn't convince them. They are concerned about implementation complexity. " +
          "David asked whether we support automated SAP synchronization.",
      },
    ],
    question: "Why is Halcyon Logistics not closing? What should I do next?",
  };
}
