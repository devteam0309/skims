const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const User = require('../models/User');
const Municipality = require('../models/Municipality');
const Barangay = require('../models/Barangay');
const Program = require('../models/Program');
const Budget = require('../models/Budget');
const Expense = require('../models/Expense');
const Liquidation = require('../models/Liquidation');
const Document = require('../models/Document');
const Notification = require('../models/Notification');
const YouthMember = require('../models/YouthMember');
const Announcement = require('../models/Announcement');

const MUNICIPALITIES = [
  { name: 'Boac', code: 'BOA', totalBarangays: 61 },
  { name: 'Buenavista', code: 'BUE', totalBarangays: 15 },
  { name: 'Gasan', code: 'GAS', totalBarangays: 25 },
  { name: 'Mogpog', code: 'MOG', totalBarangays: 37 },
  { name: 'Santa Cruz', code: 'STC', totalBarangays: 55 },
  { name: 'Torrijos', code: 'TOR', totalBarangays: 25 },
];

const BARANGAYS = {
  BOA: [
    'Agot', 'Agumaymayan', 'Amoingon', 'Apitong', 'Balagasan', 'Balaring', 'Balimbing',
    'Balogo', 'Bamban', 'Bangbangalon', 'Bantad', 'Bantay', 'Bayuti', 'Binunga', 'Boi',
    'Boton', 'Buliasnin', 'Bunganay', 'Caganhao', 'Canat', 'Catubugan', 'Cawit', 'Daig',
    'Daypay', 'Duyay', 'Hinapulan', 'Ihatub', 'Isok I (Poblacion)', 'Isok II (Poblacion)',
    'Laylay', 'Lupac', 'Mahinhin', 'Mainit', 'Malbog', 'Maligaya', 'Malusak (Poblacion)',
    'Mansiwat', 'Mataas na Bayan (Poblacion)', 'Maybo', 'Mercado (Poblacion)',
    'Murallon (Poblacion)', 'Ogbac', 'Pawa', 'Pili', 'Poctoy', 'Poras', 'Putting Buhangin',
    'Puyog', 'Sabong', 'San Miguel (Poblacion)', 'Santol', 'Sawi', 'Tabi', 'Tabigue',
    'Tagwak', 'Tambunan', 'Tampus (Poblacion)', 'Tanza', 'Tugos', 'Tumagabok', 'Tumapon',
  ],
  BUE: [
    'Bagacay', 'Bagtingon', 'Barangay I (Pob.)', 'Barangay II (Pob.)', 'Barangay III (Pob.)',
    'Barangay IV (Pob.)', 'Bicas-Bicas', 'Caigangan', 'Daykitin', 'Libas', 'Malbog',
    'Sihi', 'Timbo (Sanggulong)', 'Tungib-Lipata', 'Yook',
  ],
  GAS: [
    'Antipolo', 'Bachao Ibaba', 'Bachao Ilaya', 'Bacongbacong', 'Bahi', 'Bangbang', 'Banot',
    'Banuyo', 'Barangay I (Poblacion)', 'Barangay II (Poblacion)', 'Bognuyan', 'Cabugao',
    'Dawis', 'Dili', 'Libtangin', 'Mahunig', 'Mangiliol', 'Masiga', 'Matandang Gasan',
    'Pangi', 'Pingan', 'Tabionan', 'Tapuyan', 'Tiguion', 'Tugas',
  ],
  MOG: [
    'Anapog-Sibucao', 'Argao', 'Balanacan', 'Banto', 'Bintakay', 'Bocboc', 'Butansapa',
    'Candahon', 'Capayang', 'Danao', 'Dulong Bayan (Pob.)', 'Gitnang Bayan (Pob.)',
    'Guisian', 'Hinadharan', 'Hinanggayon', 'Ino', 'Janagdong', 'Lamesa', 'Laon',
    'Magapua', 'Malayak', 'Malusak', 'Mampaitan', 'Mangyan-Mababad', 'Market Site (Pob.)',
    'Mataas na Bayan', 'Mendez', 'Nangka I', 'Nangka II', 'Paye', 'Pili',
    'Puting Buhangin', 'Sayao', 'Silangan', 'Tambo', 'Tundag', 'Wawa',
  ],
  STC: [
    'Alobo', 'Angas', 'Aturan', 'Bagong Silang Pob. (2nd Zone)', 'Baguidbirin', 'Baliis',
    'Balogo', 'Banahaw Pob. (3rd Zone)', 'Bangcuangan', 'Banogbog', 'Biga', 'Botilao',
    'Buyabod', 'Dating Bayan', 'Devilla', 'Dolores', 'Haguimit', 'Hupi', 'Ipil', 'Jolo',
    'Kaganhao', 'Kalangkang', 'Kamandugan', 'Kasily', 'Kilo-kilo', 'Kinyaman', 'Labo',
    'Lamesa', 'Landy', 'Lapu-lapu Pob. (5th Zone)', 'Libjo', 'Lipa', 'Lusok',
    'Maharlika Pob. (1st Zone)', 'Makulapnit', 'Maniwaya', 'Manlibunan', 'Masaguisi',
    'Masalukot', 'Matalaba', 'Mongpong', 'Morales', 'Napo', 'Pag-Asa Pob. (4th Zone)',
    'Pantayin', 'Polo', 'Pulong-Parang', 'Punong', 'Salumangi', 'San Antonio',
    'San Isidro', 'Tagum', 'Tamayo', 'Tambangan', 'Tawiran',
  ],
  TOR: [
    'Bangwayin', 'Bayakbakin', 'Bolo', 'Bonliw', 'Buangan', 'Cabuyo', 'Cagpo',
    'Dampulan', 'Kay Duke', 'Mabuhay', 'Makawayan', 'Malibago', 'Malinao', 'Maranlig',
    'Marlangga', 'Matuyatuya', 'Nangka', 'Pakaskasan', 'Payanas', 'Poblacion', 'Poctoy',
    'Sibuyao', 'Suha', 'Talawan', 'Tigwi',
  ],
};

const seed = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    // Clear existing data
    await Promise.all([
      User.deleteMany({}),
      Municipality.deleteMany({}),
      Barangay.deleteMany({}),
      Program.deleteMany({}),
      Budget.deleteMany({}),
      Expense.deleteMany({}),
      Liquidation.deleteMany({}),
      Document.deleteMany({}),
      Notification.deleteMany({}),
      YouthMember.deleteMany({}),
      Announcement.deleteMany({}),
    ]);
    console.log('Cleared existing data');

    // Seed municipalities
    const municipalities = await Municipality.insertMany(MUNICIPALITIES.map((m) => ({ ...m, province: 'Marinduque', region: 'MIMAROPA' })));
    console.log(`Seeded ${municipalities.length} municipalities`);

    const munMap = {};
    municipalities.forEach((m) => { munMap[m.code] = m; });

    // Seed barangays
    const barangayDocs = [];
    for (const [code, barangayNames] of Object.entries(BARANGAYS)) {
      const mun = munMap[code];
      if (mun) {
        barangayDocs.push(...barangayNames.map((name) => ({ name, municipality: mun._id })));
      }
    }
    const barangays = await Barangay.insertMany(barangayDocs);
    console.log(`Seeded ${barangays.length} barangays`);

    // Seed users
    const usersData = [
      { firstName: 'Admin', lastName: 'Super', email: 'superadmin@skims.gov.ph', password: 'Admin@123', role: 'super_admin', isApproved: true, isEmailVerified: true },
      { firstName: 'Provincial', lastName: 'Admin', email: 'provincial@skims.gov.ph', password: 'Admin@123', role: 'provincial_admin', isApproved: true, isEmailVerified: true },
      { firstName: 'Juan', lastName: 'dela Cruz', email: 'juan@boac.gov.ph', password: 'Admin@123', role: 'sk_chairperson', municipality: munMap['BOA']._id, isApproved: true, isEmailVerified: true },
      { firstName: 'Maria', lastName: 'Santos', email: 'maria@boac.gov.ph', password: 'Admin@123', role: 'sk_treasurer', municipality: munMap['BOA']._id, isApproved: true, isEmailVerified: true },
      { firstName: 'Pedro', lastName: 'Garcia', email: 'pedro@stac.gov.ph', password: 'Admin@123', role: 'sk_chairperson', municipality: munMap['STC']._id, isApproved: true, isEmailVerified: true },
      { firstName: 'Ana', lastName: 'Reyes', email: 'ana@gasan.gov.ph', password: 'Admin@123', role: 'sk_secretary', municipality: munMap['GAS']._id, isApproved: true, isEmailVerified: true },
      { firstName: 'Liza', lastName: 'Cruz', email: 'liza@buenavista.gov.ph', password: 'Admin@123', role: 'sk_chairperson', municipality: munMap['BUE']._id, isApproved: true, isEmailVerified: true },
      { firstName: 'Ramon', lastName: 'Diaz', email: 'ramon@torrijos.gov.ph', password: 'Admin@123', role: 'sk_chairperson', municipality: munMap['TOR']._id, isApproved: true, isEmailVerified: true },
      { firstName: 'DILG', lastName: 'Officer', email: 'dilg@marinduque.gov.ph', password: 'Admin@123', role: 'dilg_representative', isApproved: true, isEmailVerified: true },
      { firstName: 'Carlos', lastName: 'Munoz', email: 'municipal@boac.gov.ph', password: 'Admin@123', role: 'municipal_admin', municipality: munMap['BOA']._id, isApproved: true, isEmailVerified: true },
      { firstName: 'Youth', lastName: 'User', email: 'youth@example.com', password: 'Admin@123', role: 'public_user', isApproved: true, isEmailVerified: true },
    ];

    const users = await User.create(usersData);
    console.log(`Seeded ${users.length} users`);

    const chairBoac = users.find((u) => u.email === 'juan@boac.gov.ph');
    const treasBoac = users.find((u) => u.email === 'maria@boac.gov.ph');
    const chairStac = users.find((u) => u.email === 'pedro@stac.gov.ph');
    const munAdmin = users.find((u) => u.email === 'municipal@boac.gov.ph');

    // Seed programs
    const programsData = [
      {
        title: 'Youth Leadership Summit 2026',
        description: 'A comprehensive leadership training program for SK youth leaders across Marinduque.',
        objectives: ['Develop leadership skills', 'Promote civic engagement', 'Build youth network'],
        category: 'governance',
        status: 'ongoing',
        municipality: munMap['BOA']._id,
        budget: 150000,
        actualExpenses: 45000,
        startDate: new Date('2026-01-15'),
        endDate: new Date('2026-12-31'),
        targetParticipants: 200,
        actualParticipants: 145,
        createdBy: chairBoac._id,
        completionRate: 40,
        isPublic: true,
      },
      {
        title: 'Kabataan Malusog Health Campaign',
        description: 'Free medical check-ups and health seminars for youth aged 15-24.',
        objectives: ['Provide free health services', 'Raise health awareness'],
        category: 'health',
        status: 'completed',
        municipality: munMap['BOA']._id,
        budget: 80000,
        actualExpenses: 78500,
        startDate: new Date('2026-03-01'),
        endDate: new Date('2026-06-30'),
        targetParticipants: 500,
        actualParticipants: 487,
        createdBy: chairBoac._id,
        completionRate: 100,
        isPublic: true,
      },
      {
        title: 'Livelihood Skills Training for Out-of-School Youth',
        description: 'Vocational training in carpentry, sewing, and food processing.',
        objectives: ['Provide skills training', 'Reduce unemployment'],
        category: 'livelihood',
        status: 'planned',
        municipality: munMap['STC']._id,
        budget: 200000,
        actualExpenses: 0,
        startDate: new Date('2026-08-01'),
        endDate: new Date('2026-11-30'),
        targetParticipants: 100,
        actualParticipants: 0,
        createdBy: chairStac._id,
        completionRate: 0,
        isPublic: true,
      },
      {
        title: 'Laro ng Lahi Sports Festival',
        description: 'Traditional Filipino games and modern sports competition.',
        objectives: ['Promote Filipino culture', 'Encourage physical fitness'],
        category: 'sports',
        status: 'delayed',
        municipality: munMap['GAS']._id,
        budget: 120000,
        actualExpenses: 30000,
        startDate: new Date('2026-04-15'),
        endDate: new Date('2026-05-31'),
        targetParticipants: 300,
        actualParticipants: 120,
        createdBy: chairBoac._id,
        completionRate: 25,
        isPublic: true,
      },
      {
        title: 'Environmental Awareness and Clean-Up Drive',
        description: 'Monthly coastal and river clean-up drives with environmental education.',
        category: 'environment',
        status: 'ongoing',
        municipality: munMap['MOG']._id,
        budget: 50000,
        actualExpenses: 18000,
        startDate: new Date('2026-02-01'),
        endDate: new Date('2026-12-31'),
        targetParticipants: 400,
        actualParticipants: 230,
        createdBy: chairBoac._id,
        completionRate: 55,
        isPublic: true,
      },
    ];

    const programs = await Program.insertMany(programsData);
    console.log(`Seeded ${programs.length} programs`);

    // Users used as budget creators per municipality
    const anaGasan = users.find((u) => u.email === 'ana@gasan.gov.ph');
    const lizaBuena = users.find((u) => u.email === 'liza@buenavista.gov.ph');
    const ramonTorrijos = users.find((u) => u.email === 'ramon@torrijos.gov.ph');
    const provincial = users.find((u) => u.role === 'provincial_admin');

    // Seed one approved FY2026 budget PER municipality.
    // Allocation categories are lowercase to match Program category enums so the
    // category-level allocation caps actually match. Allocations never exceed totalBudget.
    const budgetSpecs = [
      { code: 'BOA', creator: chairBoac, total: 1500000, allocations: [
        { category: 'health', amount: 300000, description: 'Youth health programs' },
        { category: 'education', amount: 250000 },
        { category: 'livelihood', amount: 200000 },
        { category: 'sports', amount: 150000 },
        { category: 'environment', amount: 100000 },
        { category: 'governance', amount: 200000 },
        { category: 'infrastructure', amount: 300000 },
      ] },
      { code: 'STC', creator: chairStac, total: 1200000, allocations: [
        { category: 'livelihood', amount: 400000, description: 'Skills training for out-of-school youth' },
        { category: 'education', amount: 300000 },
        { category: 'health', amount: 250000 },
        { category: 'sports', amount: 250000 },
      ] },
      { code: 'GAS', creator: anaGasan, total: 900000, allocations: [
        { category: 'sports', amount: 300000, description: 'Laro ng Lahi sports festival' },
        { category: 'culture_and_arts', amount: 200000 },
        { category: 'health', amount: 200000 },
        { category: 'environment', amount: 200000 },
      ] },
      { code: 'MOG', creator: provincial, total: 750000, allocations: [
        { category: 'environment', amount: 300000, description: 'Coastal & river clean-up drives' },
        { category: 'health', amount: 200000 },
        { category: 'governance', amount: 250000 },
      ] },
      { code: 'BUE', creator: lizaBuena, total: 600000, allocations: [
        { category: 'education', amount: 250000 },
        { category: 'livelihood', amount: 200000 },
        { category: 'governance', amount: 150000 },
      ] },
      { code: 'TOR', creator: ramonTorrijos, total: 650000, allocations: [
        { category: 'health', amount: 250000 },
        { category: 'sports', amount: 200000 },
        { category: 'social_services', amount: 200000 },
      ] },
    ];

    const budgetsByMun = {};
    for (const spec of budgetSpecs) {
      budgetsByMun[spec.code] = await Budget.create({
        title: `SK ${munMap[spec.code].name} Annual Budget 2026`,
        fiscalYear: 2026,
        municipality: munMap[spec.code]._id,
        totalBudget: spec.total,
        approvedAmount: spec.total,
        disbursedAmount: 0, // recomputed from approved expenses below
        remainingBalance: spec.total,
        status: 'approved',
        approvedBy: provincial._id,
        approvedAt: new Date('2026-01-10'),
        createdBy: spec.creator._id,
        allocations: spec.allocations,
      });
    }
    const budget = budgetsByMun['BOA']; // alias kept for downstream references
    console.log(`Seeded ${budgetSpecs.length} budgets (one per municipality)`);

    // Link each program to ITS OWN municipality's budget
    const programLinks = [
      { prog: programs[0], code: 'BOA' }, // Youth Leadership Summit (governance)
      { prog: programs[1], code: 'BOA' }, // Health Campaign (health)
      { prog: programs[2], code: 'STC' }, // Livelihood Skills (livelihood)
      { prog: programs[3], code: 'GAS' }, // Laro ng Lahi (sports)
      { prog: programs[4], code: 'MOG' }, // Environmental Clean-Up (environment)
    ];
    for (const { prog, code } of programLinks) {
      await Program.updateOne({ _id: prog._id }, { budgetRef: budgetsByMun[code]._id });
    }

    // Seed expenses — each one's program, budget and municipality all belong to the SAME municipality
    const expensesData = [
      {
        type: 'purchase_request',
        title: 'Medical Supplies for Health Campaign',
        description: 'Purchase of medicines, vitamins, and first aid supplies',
        amount: 45000,
        program: programs[1]._id, // Boac health program
        budget: budgetsByMun['BOA']._id,
        municipality: munMap['BOA']._id,
        transactionDate: new Date('2026-03-10'),
        status: 'approved',
        approvedBy: munAdmin._id,
        createdBy: treasBoac._id,
        vendor: { name: 'Marinduque Medical Supplies', address: 'Boac, Marinduque' },
      },
      {
        type: 'disbursement_voucher',
        title: 'Training Materials for Leadership Summit',
        amount: 28000,
        program: programs[0]._id, // Boac governance program
        budget: budgetsByMun['BOA']._id,
        municipality: munMap['BOA']._id,
        transactionDate: new Date('2026-02-15'),
        status: 'approved',
        approvedBy: munAdmin._id,
        createdBy: treasBoac._id,
        vendor: { name: 'ABC School Supplies', address: 'Boac, Marinduque' },
      },
      {
        type: 'official_receipt',
        title: 'Sports Equipment for Laro ng Lahi',
        amount: 30000,
        program: programs[3]._id, // Gasan sports program
        budget: budgetsByMun['GAS']._id,
        municipality: munMap['GAS']._id,
        transactionDate: new Date('2026-04-20'),
        status: 'pending',
        createdBy: anaGasan._id,
        vendor: { name: 'Sports Depot Marinduque', address: 'Gasan, Marinduque' },
      },
      {
        type: 'official_receipt',
        title: 'Coastal Clean-Up Supplies',
        amount: 18000,
        program: programs[4]._id, // Mogpog environment program
        budget: budgetsByMun['MOG']._id,
        municipality: munMap['MOG']._id,
        transactionDate: new Date('2026-03-05'),
        status: 'approved',
        approvedBy: provincial._id,
        createdBy: provincial._id,
        vendor: { name: 'Green Earth Supplies', address: 'Mogpog, Marinduque' },
      },
    ];
    for (const ed of expensesData) {
      await new Expense(ed).save();
    }
    console.log(`Seeded ${expensesData.length} expenses`);

    // Keep each budget aligned: disbursedAmount = sum of its APPROVED expenses; remaining = total - disbursed
    for (const code of Object.keys(budgetsByMun)) {
      const b = budgetsByMun[code];
      const [agg] = await Expense.aggregate([
        { $match: { budget: b._id, status: 'approved', deletedAt: null } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]);
      const disbursed = agg?.total || 0;
      await Budget.updateOne(
        { _id: b._id },
        { disbursedAmount: disbursed, remainingBalance: b.totalBudget - disbursed }
      );
    }
    console.log('Reconciled budget disbursements with approved expenses');

    // Keep each program's actualExpenses aligned with its approved expenses
    // (mirrors the runtime approveExpense behaviour: actualExpenses += approved amount)
    for (const p of programs) {
      const [agg] = await Expense.aggregate([
        { $match: { program: p._id, status: 'approved', deletedAt: null } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]);
      await Program.updateOne({ _id: p._id }, { actualExpenses: agg?.total || 0 });
    }
    console.log('Reconciled program actualExpenses with approved expenses');

    // Group barangays by municipality so each youth gets a barangay from its OWN municipality
    const barangaysByMun = {};
    barangays.forEach((b) => {
      const key = b.municipality.toString();
      (barangaysByMun[key] = barangaysByMun[key] || []).push(b);
    });

    // Seed youth members
    const youthData = Array.from({ length: 20 }, (_, i) => {
      const mun = municipalities[i % municipalities.length];
      const munBarangays = barangaysByMun[mun._id.toString()] || [];
      const barangay = munBarangays[i % munBarangays.length];
      return {
        firstName: ['Jose', 'Maria', 'Carlos', 'Ana', 'Miguel', 'Rosa', 'Antonio', 'Elena', 'Roberto', 'Carmen'][i % 10],
        lastName: ['Santos', 'Reyes', 'dela Cruz', 'Bautista', 'Ramos', 'Garcia', 'Torres', 'Flores', 'Rivera', 'Lopez'][i % 10],
        birthDate: new Date(2000 + (i % 5), i % 12, (i % 28) + 1),
        gender: i % 2 === 0 ? 'male' : 'female',
        municipality: mun._id,
        barangay: barangay?._id,
        educationalAttainment: ['college', 'high_school', 'vocational'][i % 3],
        isActive: true,
        registeredBy: chairBoac._id,
      };
    });
    await YouthMember.insertMany(youthData);
    console.log(`Seeded ${youthData.length} youth members`);

    // Seed announcements
    await Announcement.insertMany([
      {
        title: 'SK Marinduque Federation Assembly',
        content: 'All SK officials are invited to the Provincial SK Federation General Assembly on July 15, 2026.',
        type: 'event',
        municipality: munMap['BOA']._id,
        author: chairBoac._id,
        isPublic: true,
        publishedAt: new Date(),
        eventDate: new Date('2026-07-15'),
        eventLocation: 'Marinduque Capitol, Boac',
        isPinned: true,
      },
      {
        title: 'DILG Compliance Deadline Reminder',
        content: 'Reminder: Submit your ABYIP and Compliance Documents to DILG by July 31, 2026.',
        type: 'deadline',
        author: users.find((u) => u.role === 'dilg_representative')._id,
        isPublic: true,
        publishedAt: new Date(),
        isPinned: true,
      },
      {
        title: 'Youth Leadership Training Open for Applications',
        content: 'Applications are now open for the 2026 Youth Leadership Training Program.',
        type: 'announcement',
        municipality: munMap['BOA']._id,
        author: chairBoac._id,
        isPublic: true,
        publishedAt: new Date(),
      },
    ]);
    console.log('Seeded announcements');

    // Seed liquidations (sequential — referenceNumber is generated by the pre-save hook)
    const liquidationsData = [
      {
        title: 'Liquidation — Kabataan Malusog Health Campaign',
        program: programs[1]._id,
        budget: budget._id,
        municipality: munMap['BOA']._id,
        totalAmount: 78500,
        liquidatedAmount: 78500,
        status: 'approved',
        submittedBy: treasBoac._id,
        submittedAt: new Date('2026-06-20'),
        reviewedBy: munAdmin._id,
        reviewedAt: new Date('2026-06-25'),
        approvedBy: munAdmin._id,
        approvedAt: new Date('2026-06-26'),
        dueDate: new Date('2026-07-15'),
        remarks: 'Full liquidation for the completed health campaign, with complete supporting documents.',
      },
      {
        title: 'Liquidation — Youth Leadership Summit (Q1)',
        program: programs[0]._id,
        budget: budget._id,
        municipality: munMap['BOA']._id,
        totalAmount: 45000,
        liquidatedAmount: 28000,
        status: 'submitted',
        submittedBy: treasBoac._id,
        submittedAt: new Date('2026-04-05'),
        dueDate: new Date('2026-05-30'),
        remarks: 'Partial liquidation pending official receipts for catering services.',
      },
      {
        title: 'Liquidation — Leadership Summit Training Materials',
        program: programs[0]._id,
        budget: budget._id,
        municipality: munMap['BOA']._id,
        totalAmount: 28000,
        liquidatedAmount: 0,
        status: 'draft',
        submittedBy: treasBoac._id,
        dueDate: new Date('2026-06-30'),
        remarks: 'Draft — compiling receipts before submission.',
      },
    ];
    const liquidations = [];
    for (const ld of liquidationsData) {
      liquidations.push(await new Liquidation(ld).save());
    }
    console.log(`Seeded ${liquidations.length} liquidations`);

    // Seed documents
    const documentsData = [
      {
        title: 'SK Resolution No. 001 - Series of 2026',
        description: 'Resolution adopting the Annual Barangay Youth Investment Program (ABYIP) for FY 2026.',
        category: 'resolution',
        fileName: 'skims/documents/seed-resolution-001',
        originalName: 'SK-Resolution-001-2026.pdf',
        fileUrl: 'https://res.cloudinary.com/demo/raw/upload/skims/documents/seed-resolution-001.pdf',
        fileType: 'application/pdf',
        fileSize: 245678,
        municipality: munMap['BOA']._id,
        uploadedBy: chairBoac._id,
        fiscalYear: 2026,
        isPublic: true,
        tags: ['resolution', 'abyip', '2026'],
      },
      {
        title: 'Annual Barangay Youth Investment Program (ABYIP) 2026',
        description: 'Approved ABYIP detailing youth programs and budget allocations for the fiscal year.',
        category: 'abyip',
        fileName: 'skims/documents/seed-abyip-2026',
        originalName: 'ABYIP-Boac-2026.pdf',
        fileUrl: 'https://res.cloudinary.com/demo/raw/upload/skims/documents/seed-abyip-2026.pdf',
        fileType: 'application/pdf',
        fileSize: 512340,
        municipality: munMap['BOA']._id,
        uploadedBy: chairBoac._id,
        program: programs[0]._id,
        fiscalYear: 2026,
        isPublic: true,
        tags: ['abyip', 'budget', '2026'],
      },
      {
        title: 'SK Boac Annual Budget 2026',
        description: 'Approved annual budget document for SK Boac, fiscal year 2026.',
        category: 'annual_budget',
        fileName: 'skims/documents/seed-budget-2026',
        originalName: 'SK-Boac-Annual-Budget-2026.xlsx',
        fileUrl: 'https://res.cloudinary.com/demo/raw/upload/skims/documents/seed-budget-2026.xlsx',
        fileType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        fileSize: 89012,
        municipality: munMap['BOA']._id,
        uploadedBy: treasBoac._id,
        fiscalYear: 2026,
        tags: ['budget', 'annual'],
      },
      {
        title: 'Liquidation Report — Health Campaign',
        description: 'Complete liquidation report with receipts for the Kabataan Malusog Health Campaign.',
        category: 'liquidation_report',
        fileName: 'skims/documents/seed-liq-health',
        originalName: 'Liquidation-Health-Campaign.pdf',
        fileUrl: 'https://res.cloudinary.com/demo/raw/upload/skims/documents/seed-liq-health.pdf',
        fileType: 'application/pdf',
        fileSize: 334455,
        municipality: munMap['BOA']._id,
        uploadedBy: treasBoac._id,
        program: programs[1]._id,
        fiscalYear: 2026,
        tags: ['liquidation', 'health'],
      },
      {
        title: 'Q1 2026 DILG Compliance Report',
        description: 'First-quarter compliance report submitted to DILG.',
        category: 'compliance_report',
        fileName: 'skims/documents/seed-compliance-q1',
        originalName: 'DILG-Compliance-Q1-2026.pdf',
        fileUrl: 'https://res.cloudinary.com/demo/raw/upload/skims/documents/seed-compliance-q1.pdf',
        fileType: 'application/pdf',
        fileSize: 156789,
        municipality: munMap['BOA']._id,
        uploadedBy: munAdmin._id,
        fiscalYear: 2026,
        isPublic: true,
        tags: ['compliance', 'dilg', 'q1'],
      },
      {
        title: 'SK Regular Session Minutes — January 2026',
        description: 'Minutes of the SK Boac regular session held January 2026.',
        category: 'minutes',
        fileName: 'skims/documents/seed-minutes-jan',
        originalName: 'SK-Minutes-January-2026.docx',
        fileUrl: 'https://res.cloudinary.com/demo/raw/upload/skims/documents/seed-minutes-jan.docx',
        fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        fileSize: 45678,
        municipality: munMap['STC']._id,
        uploadedBy: chairStac._id,
        fiscalYear: 2026,
        tags: ['minutes', 'session'],
      },
    ];
    const documents = await Document.insertMany(documentsData);
    console.log(`Seeded ${documents.length} documents`);

    // Seed notifications (createWithExpiry applies the TTL that insertMany would otherwise bypass)
    const notificationsData = [
      {
        recipient: munAdmin._id,
        type: 'approval_request',
        title: 'Expense Pending Approval',
        message: 'A new expense "Sports Equipment for Laro ng Lahi" (₱30,000.00) is awaiting your approval.',
        link: '/expenses',
        priority: 'high',
      },
      {
        recipient: munAdmin._id,
        type: 'system',
        title: 'Welcome to SKIMS',
        message: 'Your account has full municipal administrator access for Boac.',
        isRead: true,
        readAt: new Date(),
        priority: 'low',
      },
      {
        recipient: chairBoac._id,
        type: 'deadline_reminder',
        title: 'ABYIP Submission Deadline',
        message: 'Reminder: Submit your ABYIP and Compliance Documents to DILG by July 31, 2026.',
        link: '/documents',
        priority: 'high',
      },
      {
        recipient: chairBoac._id,
        type: 'liquidation_due',
        title: 'Liquidation Due Soon',
        message: 'The liquidation for "Youth Leadership Summit" is due on May 30, 2026.',
        link: '/liquidations',
        priority: 'urgent',
      },
      {
        recipient: chairBoac._id,
        type: 'program_delay',
        title: 'Program Marked Delayed',
        message: '"Laro ng Lahi Sports Festival" has been flagged as delayed.',
        link: '/programs',
        priority: 'medium',
      },
      {
        recipient: treasBoac._id,
        type: 'approval_granted',
        title: 'Budget Approved',
        message: 'The "SK Boac Annual Budget 2026" has been approved and is now active.',
        link: '/budgets',
        isRead: true,
        readAt: new Date(),
        priority: 'medium',
      },
    ];
    await Notification.createWithExpiry(notificationsData);
    console.log(`Seeded ${notificationsData.length} notifications`);

    console.log('\n=== SEEDING COMPLETE ===');
    console.log('\nTest Accounts:');
    usersData.forEach((u) => console.log(`  ${u.role.padEnd(25)} | ${u.email.padEnd(35)} | Password: ${u.password}`));
    console.log('\nMunicipalities seeded:', municipalities.map((m) => m.name).join(', '));

    process.exit(0);
  } catch (error) {
    console.error('Seeding error:', error);
    process.exit(1);
  }
};

seed();
