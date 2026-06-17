/* One-off data-integrity audit — surfaces SILENT errors (bad refs, derived-field drift, scope mismatches). Read-only. */
require('dotenv').config();
const mongoose = require('mongoose');

const Municipality = require('../src/models/Municipality');
const Barangay = require('../src/models/Barangay');
const User = require('../src/models/User');
const Program = require('../src/models/Program');
const Budget = require('../src/models/Budget');
const Expense = require('../src/models/Expense');
const Liquidation = require('../src/models/Liquidation');
const Document = require('../src/models/Document');
const Notification = require('../src/models/Notification');
const YouthMember = require('../src/models/YouthMember');
const Announcement = require('../src/models/Announcement');

const findings = [];
const flag = (sev, area, msg) => findings.push({ sev, area, msg });

const idStr = (v) => (v && v._id ? v._id : v)?.toString();

(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const [muns, brgys, users, programs, budgets, expenses, liqs, docs, notifs, youth, anns] = await Promise.all([
    Municipality.find().lean(), Barangay.find().lean(), User.find().lean(),
    Program.find().lean(), Budget.find().lean(), Expense.find().lean(),
    Liquidation.find().lean(), Document.find().lean(), Notification.find().lean(),
    YouthMember.find().lean(), Announcement.find().lean(),
  ]);

  const munIds = new Set(muns.map((m) => idStr(m._id)));
  const brgyById = new Map(brgys.map((b) => [idStr(b._id), b]));
  const userIds = new Set(users.map((u) => idStr(u._id)));
  const progById = new Map(programs.map((p) => [idStr(p._id), p]));
  const budgetById = new Map(budgets.map((b) => [idStr(b._id), b]));

  console.log(`Loaded: ${muns.length} muns, ${brgys.length} brgys, ${users.length} users, ${programs.length} programs, ${budgets.length} budgets, ${expenses.length} expenses, ${liqs.length} liqs, ${docs.length} docs, ${notifs.length} notifs, ${youth.length} youth, ${anns.length} announcements\n`);

  // --- Barangay → municipality integrity (the bug class we already hit) ---
  for (const b of brgys) if (!munIds.has(idStr(b.municipality))) flag('HIGH', 'barangay', `Barangay ${b.name} → missing municipality ${idStr(b.municipality)}`);

  // --- Youth: barangay must belong to its municipality; refs valid ---
  for (const y of youth) {
    if (y.deletedAt) continue;
    if (!munIds.has(idStr(y.municipality))) flag('HIGH', 'youth', `Youth ${y.firstName} ${y.lastName} → bad municipality`);
    if (y.barangay) {
      const b = brgyById.get(idStr(y.barangay));
      if (!b) flag('HIGH', 'youth', `Youth ${y.firstName} ${y.lastName} → barangay does not exist`);
      else if (idStr(b.municipality) !== idStr(y.municipality)) flag('HIGH', 'youth', `Youth ${y.firstName} ${y.lastName}: barangay '${b.name}' belongs to a DIFFERENT municipality`);
    }
    const age = y.birthDate ? Math.floor((Date.now() - new Date(y.birthDate)) / (365.25 * 864e5)) : null;
    if (age != null && (age < 15 || age > 30)) flag('MED', 'youth', `Youth ${y.firstName} ${y.lastName} age ${age} outside 15-30`);
  }

  // --- Budgets: derived fields + allocation sanity + scope ---
  for (const bu of budgets) {
    if (bu.deletedAt) continue;
    if (!munIds.has(idStr(bu.municipality))) flag('HIGH', 'budget', `Budget '${bu.title}' → bad municipality`);
    if (!userIds.has(idStr(bu.createdBy))) flag('MED', 'budget', `Budget '${bu.title}' → createdBy missing`);
    const expectRemain = (bu.totalBudget || 0) - (bu.disbursedAmount || 0);
    if (Math.abs(expectRemain - (bu.remainingBalance || 0)) > 0.005) flag('HIGH', 'budget', `Budget '${bu.title}': remaining ${bu.remainingBalance} != total-disbursed ${expectRemain}`);
    const allocSum = (bu.allocations || []).reduce((s, a) => s + (a.amount || 0), 0);
    if (allocSum > (bu.totalBudget || 0) + 0.005) flag('HIGH', 'budget', `Budget '${bu.title}': allocations ${allocSum} > total ${bu.totalBudget}`);
    if (bu.disbursedAmount < 0 || bu.remainingBalance < 0) flag('HIGH', 'budget', `Budget '${bu.title}': negative disbursed/remaining`);
  }

  // --- Budget.disbursedAmount must equal SUM(approved expenses charged to it) ---
  const apprByBudget = new Map();
  for (const e of expenses) {
    if (e.deletedAt || e.status !== 'approved' || !e.budget) continue;
    apprByBudget.set(idStr(e.budget), (apprByBudget.get(idStr(e.budget)) || 0) + (e.amount || 0));
  }
  for (const bu of budgets) {
    if (bu.deletedAt) continue;
    const realDisb = apprByBudget.get(idStr(bu._id)) || 0;
    if (Math.abs(realDisb - (bu.disbursedAmount || 0)) > 0.005) flag('HIGH', 'budget', `Budget '${bu.title}': disbursedAmount ${bu.disbursedAmount} != approved-expense sum ${realDisb}`);
  }

  // --- Expenses: refs valid + program/budget/municipality coherence + budget overspend ---
  for (const e of expenses) {
    if (e.deletedAt) continue;
    if (!munIds.has(idStr(e.municipality))) flag('HIGH', 'expense', `Expense '${e.title}' → bad municipality`);
    if (e.budget) {
      const b = budgetById.get(idStr(e.budget));
      if (!b) flag('HIGH', 'expense', `Expense '${e.title}' → budget does not exist`);
      else if (idStr(b.municipality) !== idStr(e.municipality)) flag('HIGH', 'expense', `Expense '${e.title}': budget municipality != expense municipality`);
    }
    if (e.program) {
      const p = progById.get(idStr(e.program));
      if (!p) flag('HIGH', 'expense', `Expense '${e.title}' → program does not exist`);
      else if (idStr(p.municipality) !== idStr(e.municipality)) flag('MED', 'expense', `Expense '${e.title}': program municipality != expense municipality`);
    }
    if (!userIds.has(idStr(e.createdBy))) flag('MED', 'expense', `Expense '${e.title}' → createdBy missing`);
  }

  // --- Programs: refs + actualExpenses vs real approved expenses ---
  const apprByProgram = new Map();
  for (const e of expenses) {
    if (e.deletedAt || e.status !== 'approved' || !e.program) continue;
    apprByProgram.set(idStr(e.program), (apprByProgram.get(idStr(e.program)) || 0) + (e.amount || 0));
  }
  for (const p of programs) {
    if (p.deletedAt) continue;
    if (!munIds.has(idStr(p.municipality))) flag('HIGH', 'program', `Program '${p.title}' → bad municipality`);
    if (p.budgetRef && !budgetById.has(idStr(p.budgetRef))) flag('HIGH', 'program', `Program '${p.title}' → budgetRef does not exist`);
    if (p.budgetRef) {
      const b = budgetById.get(idStr(p.budgetRef));
      if (b && idStr(b.municipality) !== idStr(p.municipality)) flag('HIGH', 'program', `Program '${p.title}': budgetRef municipality != program municipality`);
    }
    const realAE = apprByProgram.get(idStr(p._id)) || 0;
    if (Math.abs(realAE - (p.actualExpenses || 0)) > 0.005) flag('MED', 'program', `Program '${p.title}': actualExpenses ${p.actualExpenses} != approved-expense sum ${realAE}`);
    if (p.endDate && p.startDate && new Date(p.endDate) < new Date(p.startDate)) flag('MED', 'program', `Program '${p.title}': endDate before startDate`);
    if (p.completionRate != null && (p.completionRate < 0 || p.completionRate > 100)) flag('MED', 'program', `Program '${p.title}': completionRate ${p.completionRate} out of range`);
  }

  // --- Liquidations: refs + variance + amount sanity ---
  for (const l of liqs) {
    if (l.deletedAt) continue;
    if (!munIds.has(idStr(l.municipality))) flag('HIGH', 'liquidation', `Liq '${l.title}' → bad municipality`);
    if (l.program && !progById.has(idStr(l.program))) flag('HIGH', 'liquidation', `Liq '${l.title}' → program missing`);
    if (l.program) {
      const p = progById.get(idStr(l.program));
      if (p && idStr(p.municipality) !== idStr(l.municipality)) flag('MED', 'liquidation', `Liq '${l.title}': program municipality != liq municipality`);
    }
    if ((l.liquidatedAmount || 0) > (l.totalAmount || 0) + 0.005) flag('HIGH', 'liquidation', `Liq '${l.title}': liquidated > total`);
    const expectVar = (l.totalAmount || 0) - (l.liquidatedAmount || 0);
    if (Math.abs(expectVar - (l.variance || 0)) > 0.005) flag('MED', 'liquidation', `Liq '${l.title}': variance ${l.variance} != total-liquidated ${expectVar}`);
  }

  // --- Documents: refs + category enum ---
  const DOC_CATS = Document.DOCUMENT_CATEGORIES;
  for (const d of docs) {
    if (d.deletedAt) continue;
    if (d.municipality && !munIds.has(idStr(d.municipality))) flag('MED', 'document', `Doc '${d.title}' → bad municipality`);
    if (!userIds.has(idStr(d.uploadedBy))) flag('MED', 'document', `Doc '${d.title}' → uploadedBy missing`);
    if (!DOC_CATS.includes(d.category)) flag('MED', 'document', `Doc '${d.title}' → invalid category '${d.category}'`);
  }

  // --- Notifications: recipient must exist ---
  for (const n of notifs) if (!userIds.has(idStr(n.recipient))) flag('MED', 'notification', `Notification '${n.title}' → recipient missing`);

  // --- Announcements: author + municipality (optional) ---
  for (const a of anns) {
    if (a.author && !userIds.has(idStr(a.author))) flag('MED', 'announcement', `Announcement '${a.title}' → author missing`);
    if (a.municipality && !munIds.has(idStr(a.municipality))) flag('MED', 'announcement', `Announcement '${a.title}' → bad municipality`);
  }

  // --- Users: municipality scope (non-global roles should have one) ---
  const GLOBAL = ['super_admin', 'provincial_admin', 'dilg_representative', 'public_user'];
  for (const u of users) {
    if (u.deletedAt) continue;
    if (u.municipality && !munIds.has(idStr(u.municipality))) flag('HIGH', 'user', `User ${u.email} → bad municipality`);
    if (!GLOBAL.includes(u.role) && !u.municipality) flag('MED', 'user', `User ${u.email} (${u.role}) has NO municipality`);
  }

  // --- Report ---
  const order = { HIGH: 0, MED: 1, LOW: 2 };
  findings.sort((a, b) => order[a.sev] - order[b.sev]);
  console.log(`=== INTEGRITY FINDINGS: ${findings.length} ===`);
  if (!findings.length) console.log('  ✓ No silent data-integrity issues found.');
  for (const f of findings) console.log(`  [${f.sev}] ${f.area}: ${f.msg}`);
  const high = findings.filter((f) => f.sev === 'HIGH').length;
  console.log(`\nHIGH: ${high}  MED: ${findings.filter((f) => f.sev === 'MED').length}`);

  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => { console.error('AUDIT CRASHED:', e); process.exit(1); });
