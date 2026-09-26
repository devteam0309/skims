const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const User = require('../models/User');
const Municipality = require('../models/Municipality');
const Barangay = require('../models/Barangay');
const PDFDocument = require('pdfkit');
const { uploadToCloudinary } = require('../config/cloudinary');
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
  { name: 'Gasan', code: 'GAS', totalBarangays: 25 },
  { name: 'Mogpog', code: 'MOG', totalBarangays: 37 },
  { name: 'Santa Cruz', code: 'STC', totalBarangays: 55 },
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
};

const seed = async () => {
  try {
    const isProd = process.env.NODE_ENV === 'production';
    // Demo data (the Admin@123 accounts + sample programs/budgets/etc.) is opt-in.
    // Default ON outside production for local/QA convenience; in production it MUST be
    // explicitly requested with SEED_DEMO=true so a prod seed never creates demo logins.
    const seedDemo = isProd
      ? process.env.SEED_DEMO === 'true'
      : process.env.SEED_DEMO !== 'false';

    // This seeder WIPES every collection. In production, require explicit confirmation
    // so it can never silently destroy live data.
    if (isProd && process.env.SEED_CONFIRM !== 'true') {
      console.error('Refusing to run the seeder in production without SEED_CONFIRM=true.');
      console.error('This deletes ALL data in the target database. Set SEED_CONFIRM=true only if you are sure.');
      process.exit(1);
    }

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

    // Non-demo path: seed reference data only (municipalities + barangays above), plus an
    // optional real super-admin from env. No shared-password demo accounts are created.
    if (!seedDemo) {
      const adminEmail = process.env.SEED_ADMIN_EMAIL;
      const adminPassword = process.env.SEED_ADMIN_PASSWORD;
      if (adminEmail && adminPassword) {
        await User.create({
          firstName: 'System',
          lastName: 'Administrator',
          email: adminEmail,
          password: adminPassword,
          role: 'super_admin',
          isApproved: true,
          isEmailVerified: true,
        });
        console.log(`Seeded super-admin account: ${adminEmail}`);
      } else {
        console.log('No SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD provided — no admin account created.');
        console.log('Register an account and promote it, or re-run with those vars set.');
      }
      console.log('\n=== SEEDING COMPLETE (reference data only) ===');
      console.log('Demo dataset skipped. Set SEED_DEMO=true to include sample users/programs/etc.');
      process.exit(0);
    }

    /*
     * One real file behind every seeded document.
     *
     * The seeder used to fabricate `fileUrl`s under Cloudinary's public `demo` cloud —
     * `res.cloudinary.com/demo/raw/upload/skims/documents/seed-*.pdf` — for files that were never
     * uploaded anywhere. The metadata, filters and counts all worked, so it looked fine until
     * somebody pressed Download and got ERR_INVALID_RESPONSE from a 404 at Cloudinary. It reads as
     * a broken feature; it was fake data, in both the portal and the authenticated Documents page.
     *
     * So: generate a real one-page PDF, upload it ONCE, and point every seeded document at it. A
     * fixed public_id with overwrite means re-seeding replaces the same asset instead of leaving a
     * new orphan behind on each run.
     *
     * If Cloudinary is not configured, seeded documents get NO fileUrl rather than a dead one — the
     * download routes now say "no file attached", which is true, instead of redirecting the browser
     * somewhere that does not exist.
     */
    /*
     * Built with PDFKit, which already generates the ABYIP and COA report templates.
     *
     * The first version of this was a hand-written PDF with no xref table. It uploaded and
     * downloaded, but "a viewer will accept it" was an assumption — strict readers repair such a
     * file or refuse it outright, and the one thing this document must do is OPEN when somebody
     * clicks Download.
     *
     * The wording matters as much as the format. Every seeded document points at this one file, so
     * the page cannot describe any particular record — and a reader who opens "SK Resolution No.
     * 2026-01" and finds two words of placeholder text learns nothing about why. It says what it
     * is, why its title will not match, and what to do about it.
     */
    const samplePdf = () => new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 64 });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(20).fillColor('#1e3a5f').text('SKIMS sample document');
      doc.moveDown(0.3);
      // ASCII punctuation on purpose: the standard PDF fonts encode it without question, and this
      // is the one file in the system guaranteed to be opened by someone who is not a developer.
      doc.fontSize(12).fillColor('#444444').text('Seeded demo data - not a real SK record.');
      doc.moveDown(1.2);

      doc.fontSize(11).fillColor('#222222').text(
        'Please upload real files to replace them.',
        { continued: false },
      );
      doc.moveDown(0.8);

      doc.fontSize(10).fillColor('#555555').text(
        'Every document created by the seeder links to this same placeholder file, so the title and '
        + 'category shown in SKIMS will not match anything on this page. Replacing a seeded record is '
        + 'the ordinary upload: open Documents, upload the real file, then delete the placeholder.',
        { align: 'left', lineGap: 2 },
      );
      doc.moveDown(1.5);

      doc.fontSize(9).fillColor('#777777').text(
        'Sangguniang Kabataan Integrated Program and Fund Management System',
      );
      doc.fontSize(9).fillColor('#777777').text('Boac, Gasan, Mogpog and Santa Cruz');

      doc.end();
    });

    let sampleFileUrl = null;
    let sampleFileName = null;
    try {
      const uploaded = await uploadToCloudinary(await samplePdf(), {
        folder: 'skims/documents',
        resource_type: 'raw',
        // `.pdf` now that PDF delivery is enabled on the account — the seeded document downloads
        // as a real PDF rather than an anonymous raw blob.
        public_id: 'seed-sample-document.pdf',
        overwrite: true,
      });
      sampleFileUrl = uploaded.secure_url;
      sampleFileName = uploaded.public_id;
      console.log('Uploaded the sample document that seeded records point at');
    } catch (err) {
      // Not fatal. A seed without Cloudinary is still a useful seed; it just has no downloadable file.
      console.log(`No Cloudinary upload (${err?.message || 'not configured'}) — seeded documents will have no file attached`);
    }

    // Seed users
    // Shared demo password. The seeded youth logins use the same one, so a reviewer only needs to
    // remember one credential across every account type.
    const DEMO_PASSWORD = 'Admin@123';

    /*
     * Barangay assignments for the demo.
     *
     * SK accounts are barangay-scoped now, and no real account has ever had a barangay — so without
     * this the feature is invisible in a demo and nothing shows that Barangay A's chairperson cannot
     * see Barangay B's registry.
     *
     * Boac's chairperson and treasurer are put in DIFFERENT barangays deliberately: one account
     * cannot demonstrate isolation, and Boac's municipal_admin (Carlos) sees both, which is the
     * contrast that makes the rule legible.
     *
     * Santa Cruz's chairperson and Gasan's secretary are left UNASSIGNED on purpose. That is the
     * state every existing account is in, and it has to keep working: they stay municipality-wide.
     */
    /*
     * Two demo barangays per municipality, not just Boac's.
     *
     * Every SK officer the seeder creates gets one, and that municipality's ten youth are split
     * between the two — so each officer opens a registry with five members instead of one, and any
     * pair of officers in the same municipality demonstrates that neither sees the other's roster.
     *
     * Assigning them HERE rather than through the migration script matters: a re-seed recreates
     * every user, so an assignment made afterwards is destroyed by the next seed. This survives.
     */
    const demoBarangays = {};
    for (const code of Object.keys(munMap)) {
      const own = barangays.filter((b) => b.municipality.toString() === munMap[code]._id.toString());
      demoBarangays[code] = [own[0], own[1]];
    }
    const [chairBarangay, treasurerBarangay] = demoBarangays['BOA'];

    const usersData = [
      { firstName: 'Admin', lastName: 'Super', email: 'superadmin@skims.gov.ph', password: 'Admin@123', role: 'super_admin', isApproved: true, isEmailVerified: true },
      { firstName: 'Provincial', lastName: 'Admin', email: 'provincial@skims.gov.ph', password: 'Admin@123', role: 'provincial_admin', isApproved: true, isEmailVerified: true },
      { firstName: 'Juan', lastName: 'dela Cruz', email: 'juan@boac.gov.ph', password: 'Admin@123', role: 'sk_chairperson', municipality: munMap['BOA']._id, barangay: chairBarangay._id, isApproved: true, isEmailVerified: true },
      { firstName: 'Maria', lastName: 'Santos', email: 'maria@boac.gov.ph', password: 'Admin@123', role: 'sk_treasurer', municipality: munMap['BOA']._id, barangay: treasurerBarangay._id, isApproved: true, isEmailVerified: true },
      { firstName: 'Pedro', lastName: 'Garcia', email: 'pedro@stac.gov.ph', password: 'Admin@123', role: 'sk_chairperson', municipality: munMap['STC']._id, barangay: demoBarangays['STC'][0]._id, isApproved: true, isEmailVerified: true },
      { firstName: 'Ana', lastName: 'Reyes', email: 'ana@gasan.gov.ph', password: 'Admin@123', role: 'sk_secretary', municipality: munMap['GAS']._id, barangay: demoBarangays['GAS'][0]._id, isApproved: true, isEmailVerified: true },
      { firstName: 'DILG', lastName: 'Officer', email: 'dilg@marinduque.gov.ph', password: 'Admin@123', role: 'dilg_representative', isApproved: true, isEmailVerified: true },
      { firstName: 'Carlos', lastName: 'Munoz', email: 'municipal@boac.gov.ph', password: 'Admin@123', role: 'municipal_admin', municipality: munMap['BOA']._id, isApproved: true, isEmailVerified: true },
    ];

    const users = await User.create(usersData);
    console.log(`Seeded ${users.length} users`);

    const chairBoac = users.find((u) => u.email === 'juan@boac.gov.ph');
    const treasBoac = users.find((u) => u.email === 'maria@boac.gov.ph');
    const chairStac = users.find((u) => u.email === 'pedro@stac.gov.ph');
    // Needed as a programme creator below; `anaGasan` proper is resolved later for budgets.
    const anaGasanEarly = users.find((u) => u.email === 'ana@gasan.gov.ph');
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
        /*
         * Targeted at the chairperson's own barangay, so the Programs page demonstrates the target
         * barangay column and the barangay filter. The health campaign below is deliberately left
         * with no barangay: it is a municipality-wide programme, which is the other legitimate
         * state and the one every pre-existing record is in.
         */
        barangay: chairBarangay._id,
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
        isPublic: true      },

      /*
       * Additional programs so every municipality has a spread rather than a single record.
       *
       * With one program each, three of the four municipalities showed a list of exactly one, and
       * Gasan's happened to be `delayed` — so an SK Secretary there opened Programs and saw nothing
       * but a delayed programme, which reads as a broken filter rather than as the whole of their
       * municipality's portfolio. Each municipality now carries several across different statuses
       * and approval states, which is also what makes the status chips and the completed count
       * mean anything in a demo.
       */
      {
        title: 'Gasan Coastal Clean-Up Quarterly Drive',
        description: 'Quarterly shoreline clean-up and waste segregation drive with barangay volunteers.',
        objectives: ['Reduce coastal waste', 'Build volunteer habits'],
        category: 'environment',
        status: 'ongoing',
        municipality: munMap['GAS']._id,
        budget: 60000,
        startDate: new Date('2026-02-01'),
        endDate: new Date('2026-11-30'),
        targetParticipants: 150,
        actualParticipants: 96,
        createdBy: anaGasanEarly._id,
        completionRate: 60,
        isPublic: true,
      },
      {
        title: 'Gasan Youth Skills and Livelihood Workshop',
        description: 'Basic vocational workshops in food processing and handicraft for out-of-school youth.',
        objectives: ['Teach a marketable skill', 'Support out-of-school youth'],
        category: 'livelihood',
        status: 'completed',
        municipality: munMap['GAS']._id,
        budget: 90000,
        startDate: new Date('2026-01-10'),
        endDate: new Date('2026-05-30'),
        targetParticipants: 80,
        actualParticipants: 74,
        createdBy: anaGasanEarly._id,
        completionRate: 100,
        isPublic: true,
      },
      {
        title: 'Mogpog Kabataan Sports League',
        description: 'Inter-barangay basketball and volleyball league for registered SK youth members.',
        objectives: ['Promote physical wellbeing', 'Strengthen barangay ties'],
        category: 'sports',
        status: 'planned',
        municipality: munMap['MOG']._id,
        budget: 110000,
        startDate: new Date('2026-09-15'),
        endDate: new Date('2026-12-15'),
        targetParticipants: 240,
        createdBy: chairBoac._id,
        isPublic: true,
      },
      {
        title: 'Mogpog Youth Mental Health Forum',
        description: 'Series of guided sessions on mental wellbeing run with the municipal health office.',
        objectives: ['Reduce stigma', 'Signpost local support'],
        category: 'health',
        status: 'completed',
        municipality: munMap['MOG']._id,
        budget: 45000,
        startDate: new Date('2026-02-20'),
        endDate: new Date('2026-06-20'),
        targetParticipants: 120,
        actualParticipants: 118,
        createdBy: chairBoac._id,
        completionRate: 100,
        isPublic: true,
      },
      {
        title: 'Sta. Cruz Youth Leadership Bootcamp',
        description: 'Residential leadership training for incoming SK officials and barangay youth leaders.',
        objectives: ['Develop leadership skills', 'Prepare incoming officials'],
        category: 'governance',
        status: 'ongoing',
        municipality: munMap['STC']._id,
        budget: 130000,
        startDate: new Date('2026-04-01'),
        endDate: new Date('2026-10-31'),
        targetParticipants: 100,
        actualParticipants: 63,
        createdBy: chairStac._id,
        completionRate: 55,
        isPublic: true,
      },
      {
        title: 'Sta. Cruz Barangay Reading Corner',
        description: 'Sets up small reading corners with donated books in five barangay halls.',
        objectives: ['Improve literacy access', 'Encourage reading among youth'],
        category: 'education',
        status: 'completed',
        municipality: munMap['STC']._id,
        budget: 55000,
        startDate: new Date('2026-01-20'),
        endDate: new Date('2026-05-20'),
        targetParticipants: 200,
        actualParticipants: 210,
        createdBy: chairStac._id,
        completionRate: 100,
        isPublic: true,
      },
      {
        title: 'Boac Digital Literacy for Youth',
        description: 'Introductory computer and online-safety classes held at the municipal library.',
        objectives: ['Build digital skills', 'Teach online safety'],
        category: 'education',
        status: 'delayed',
        municipality: munMap['BOA']._id,
        budget: 70000,
        startDate: new Date('2026-03-01'),
        endDate: new Date('2026-08-01'),
        targetParticipants: 90,
        actualParticipants: 31,
        /*
         * Authorship must be someone who could actually have authored it. POST /programs is
         * restricted to EDITORS, which excludes sk_treasurer — so attributing this to Maria Santos
         * described a creation the application would have refused, and made the Details panel read
         * as though it were naming the wrong person.
         */
        createdBy: chairBoac._id,
        completionRate: 30,
        isPublic: true,
      },
    ];

    const programs = await Program.insertMany(programsData);
    console.log(`Seeded ${programs.length} programs`);

    // Users used as budget creators per municipality
    const anaGasan = users.find((u) => u.email === 'ana@gasan.gov.ph');
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
    /*
     * Looked up by title rather than by array position. Positional links silently misalign the
     * moment a programme is inserted anywhere but the end of the list — a budget would then be
     * attached to the wrong programme, and in the wrong municipality, with nothing to show for it.
     *
     * Not every programme is linked, deliberately: the rest stand as approved work with no budget
     * attached, which is a state the system is required to support.
     */
    const byTitle = Object.fromEntries(programs.map((p) => [p.title, p]));
    const programLinks = [
      { title: 'Youth Leadership Summit 2026', code: 'BOA' },
      { title: 'Kabataan Malusog Health Campaign', code: 'BOA' },
      { title: 'Livelihood Skills Training for Out-of-School Youth', code: 'STC' },
      { title: 'Laro ng Lahi Sports Festival', code: 'GAS' },
      { title: 'Environmental Awareness and Clean-Up Drive', code: 'MOG' },
    ].map(({ title, code }) => {
      const prog = byTitle[title];
      if (!prog) throw new Error(`Seed error: no programme titled "${title}" to link to the ${code} budget`);
      if (prog.municipality.toString() !== munMap[code]._id.toString()) {
        throw new Error(`Seed error: "${title}" is not in ${code}; linking it there would cross municipalities`);
      }
      return { prog, code };
    });
    for (const { prog, code } of programLinks) {
      await Program.updateOne({ _id: prog._id }, { budgetRef: budgetsByMun[code]._id });
    }

    /*
     * Approval state for the seeded programs.
     *
     * A program that is already ongoing or completed must read as approved — leaving them at the
     * schema default of 'draft' would show a running program still awaiting clearance. The two
     * that have not started are left mid-workflow on purpose so the approval flow is demonstrable
     * without first having to create a program: one is waiting on a decision, one was sent back.
     */
    for (const prog of programs) {
      const running = ['ongoing', 'completed', 'delayed'].includes(prog.status);
      await Program.updateOne({ _id: prog._id }, running
        ? { approvalStatus: 'approved', approvedBy: provincial._id, approvedAt: new Date('2026-01-12') }
        : { approvalStatus: 'submitted', submittedAt: new Date('2026-02-01') });
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
    /*
     * Sta. Cruz had no expenses at all, so its Expenses page and every figure derived from it read
     * as zero — the same emptiness that was reported as a bug for Documents and for Gasan's
     * programmes. Looked up by title, with the municipality asserted, like the budget links above.
     */
    const stcProgram = byTitle['Sta. Cruz Youth Leadership Bootcamp'];
    if (!stcProgram) throw new Error('Seed error: no Sta. Cruz programme to charge an expense to');
    if (stcProgram.municipality.toString() !== munMap['STC']._id.toString()) {
      throw new Error('Seed error: the Sta. Cruz bootcamp is not in STC; the expense would cross municipalities');
    }
    expensesData.push({
      type: 'purchase_order',
      title: 'Venue and Catering for Leadership Bootcamp',
      description: 'Hall rental and meals for the three-day bootcamp.',
      amount: 52000,
      program: stcProgram._id,
      budget: budgetsByMun['STC']._id,
      municipality: munMap['STC']._id,
      transactionDate: new Date('2026-05-12'),
      status: 'approved',
      approvedBy: provincial._id,
      createdBy: chairStac._id,
      vendor: { name: 'Marinduque Events and Catering', address: 'Santa Cruz, Marinduque' },
    });

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

      /*
       * Commitments follow the same rule the runtime uses: an approved program encumbers what it
       * has not yet spent. Seeding committedAmount as a flat program total would double-count the
       * part already disbursed against it, so each program contributes budget − actualExpenses,
       * floored at zero for a program that has overspent.
       */
      const linked = await Program.find({ budgetRef: b._id, approvalStatus: 'approved', deletedAt: null })
        .select('budget actualExpenses');
      const committed = linked.reduce(
        (sum, p) => sum + Math.max(0, (p.budget || 0) - (p.actualExpenses || 0)),
        0
      );

      await Budget.updateOne(
        { _id: b._id },
        { disbursedAmount: disbursed, committedAmount: committed, remainingBalance: b.totalBudget - disbursed }
      );
      await Program.updateMany(
        { budgetRef: b._id, approvalStatus: 'approved', deletedAt: null },
        [{ $set: { committedAmount: { $max: [0, { $subtract: ['$budget', '$actualExpenses'] }] } } }]
      );
    }
    console.log('Reconciled budget disbursements and program commitments');

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

    // Seed youth members — first/last name arrays are indexed directly (20 entries each)
    // so every seeded youth gets a unique full name
    /*
     * One entry per member, indexed directly, so every seeded youth has a distinct full name.
     *
     * These held 20 entries each while the registry seeded 40 members, indexed with `i % 20` and
     * `(i * 3) % 20`. Both wrap at the same point, so members i and i+20 received the identical
     * first and last name — every name in the registry appeared exactly twice. It passed the
     * duplicate check only because that index is {firstName, lastName, birthDate, municipality}
     * and the birth dates differed.
     */
    const YOUTH_FIRST_NAMES = [
      'Jose', 'Maria', 'Carlos', 'Ana', 'Miguel', 'Rosa', 'Antonio', 'Elena', 'Roberto', 'Carmen',
      'Paolo', 'Isabel', 'Ricardo', 'Teresa', 'Andres', 'Lourdes', 'Felipe', 'Cristina', 'Manuel', 'Dolores',
      'Rafael', 'Bianca', 'Emilio', 'Sofia', 'Diego', 'Lucia', 'Nathaniel', 'Camila', 'Julian', 'Beatriz',
      'Marco', 'Angeline', 'Enrico', 'Trisha', 'Gabriel', 'Katrina', 'Vincent', 'Michelle', 'Rommel', 'Jasmine',
    ];
    const YOUTH_LAST_NAMES = [
      'Santos', 'Reyes', 'dela Cruz', 'Bautista', 'Ramos', 'Garcia', 'Torres', 'Flores', 'Rivera', 'Lopez',
      'Mendoza', 'Aquino', 'Castillo', 'Villanueva', 'Domingo', 'Navarro', 'Salazar', 'Aguilar', 'Ocampo', 'Pascual',
      'Manalo', 'Fernandez', 'Marasigan', 'Bernardo', 'Panganiban', 'Custodio', 'Espiritu', 'Magbanua', 'Sarmiento', 'Valdez',
      'Alcantara', 'Quimpo', 'Rosales', 'Cabrera', 'Ilagan', 'Trinidad', 'Zamora', 'Bulaong', 'Lascano', 'Peralta',
    ];
    /*
     * 40 members, deliberately spread rather than uniform.
     *
     * The previous 20 covered three of the six educational levels (never 'elementary'), were all
     * active, were all aged 21-26, and — because the barangay was picked with `i % length` and
     * each municipality only got five members — only ever landed in the first five barangays of
     * each. A reviewer filtering the registry by Elementary, or by a real barangay like Tanza,
     * got an empty table and reasonably read it as a broken filter. The data has to be able to
     * demonstrate the filters that exist.
     *
     * The dedup index is {firstName, lastName, birthDate, municipality}; pairing the two name
     * arrays with different strides keeps all 40 combinations unique.
     */
    /*
     * The six suggested levels, plus two a registrar would realistically type themselves. Seeding a
     * couple of custom values is the only way the registry demonstrates that the field accepts one —
     * with the standard six alone, the free-text capability is invisible in demo data and reads as
     * though the dropdown is still closed.
     */
    const EDUCATION_LEVELS = [
      'elementary', 'high_school', 'college', 'vocational', 'graduate', 'out_of_school',
      'als_completer', 'senior_high',
    ];

    const youthData = Array.from({ length: 40 }, (_, i) => {
      const mun = municipalities[i % municipalities.length];
      const munBarangays = barangaysByMun[mun._id.toString()] || [];

      /*
       * Each municipality's ten members are split between its two demo barangays, so every officer
       * opens a registry with five in it.
       *
       * Spread evenly instead — a stride across all 61 Boac barangays — each officer saw exactly one
       * member and read correct barangay scoping as a broken filter. Thin demo data has been
       * misdiagnosed as a defect on this project four times; this is the fifth avoided.
       *
       * The fallback stride remains for any municipality with no demo pair.
       */
      const code = Object.keys(munMap).find((c) => munMap[c]._id.toString() === mun._id.toString());
      const pair = demoBarangays[code];
      const barangay = pair && pair[0] && pair[1]
        ? pair[Math.floor(i / municipalities.length) % 2]
        : (munBarangays.length ? munBarangays[(i * 7) % munBarangays.length] : undefined);

      /*
       * Ages 15-30 are under the SK; every fifth member is seeded past 30 so the registry has
       * genuine "aged out" records to distinguish from inactive ones. They are legitimate
       * historical members — someone who was registered at 29 and is now 31.
       */
      const agedOut = i % 5 === 4;
      const age = agedOut ? 31 + (i % 3) : 15 + (i % 15);

      /*
       * Anchored to today and walked backwards, not `new Date(year - age, ...)`. Subtracting
       * years alone leaves anyone whose birthday falls later in the calendar year a year younger
       * than intended — it seeded a 14-year-old into an age-gated registry, which the create
       * route would itself have rejected. Going backwards in days can only make a member older,
       * so the floor holds: `age` becomes `age` or `age + 1`, never less.
       */
      const birthDate = new Date();
      birthDate.setFullYear(birthDate.getFullYear() - age);
      birthDate.setDate(birthDate.getDate() - ((i * 9) % 330));

      return {
        firstName: YOUTH_FIRST_NAMES[i],
        lastName: YOUTH_LAST_NAMES[i],
        /*
         * Their login, and half of the identity rule (full name + email). Built from the name,
         * which is unique per member, so the addresses are too. example.com is reserved by RFC
         * 2606 and can never route to a real person's inbox.
         */
        email: `${YOUTH_FIRST_NAMES[i]}.${YOUTH_LAST_NAMES[i]}`
          .toLowerCase().replace(/[^a-z0-9.]+/g, '') + '@example.com',
        birthDate,
        // Mostly male/female, with a couple of free-text entries so the registry shows that the
        // field accepts what a member actually identifies as.
        gender: i % 11 === 3 ? 'LGBTQIA+' : (i % 2 === 0 ? 'Male' : 'Female'),
        municipality: mun._id,
        barangay: barangay?._id,
        educationalAttainment: EDUCATION_LEVELS[i % EDUCATION_LEVELS.length],
        // A minority are inactive, so Active/Inactive is visibly a distinction and not a
        // column that reads the same on every row.
        isActive: i % 7 !== 6,
        registeredBy: chairBoac._id,
      };
    });
    /*
     * Fail loudly rather than seeding a registry full of repeated people. The previous duplication
     * was invisible: the collection's unique index also keys on birthDate and municipality, so
     * forty members sharing twenty names inserted without complaint and only showed up by reading
     * the registry. Raising the member count past the name lists now stops the seed instead of
     * silently wrapping back to the first name.
     */
    const fullNames = youthData.map((y) => `${y.firstName} ${y.lastName}`);
    const uniqueNames = new Set(fullNames);
    if (uniqueNames.size !== youthData.length) {
      const dupes = [...new Set(fullNames.filter((n, i) => fullNames.indexOf(n) !== i))];
      throw new Error(
        `Seed would create ${youthData.length - uniqueNames.size} duplicate youth name(s): ${dupes.join(', ')}. `
        + 'Extend YOUTH_FIRST_NAMES / YOUTH_LAST_NAMES to one entry per member.'
      );
    }

    /*
     * Every seeded youth gets their own login, because youth are account holders now — a registry
     * with no logins behind it cannot demonstrate self-registration, joining, or the closed role.
     *
     * Created here rather than through the register route so they arrive already verified and
     * approved: the route would fire 40 verification emails and leave 40 accounts that cannot sign
     * in until someone clicks 40 links. `User.create` (not insertMany) so the password-hashing
     * pre-save hook runs — insertMany bypasses it and would store plaintext.
     *
     * These are NOT added to the QA credentials panel. Forty rows would bury the eight staff
     * accounts it exists to show, and that panel is currently visible on the public production
     * site. One sample youth is listed there instead; the rest follow the same pattern.
     */
    const youthUsers = await User.create(youthData.map((y) => ({
      firstName: y.firstName,
      lastName: y.lastName,
      email: y.email,
      password: DEMO_PASSWORD,
      role: 'youth',
      municipality: y.municipality,
      barangay: y.barangay,
      contactNumber: y.contactNumber,
      isEmailVerified: true,
      isApproved: true,
      isActive: true,
    })));

    const youthWithLogins = youthData.map((y, i) => ({
      ...y,
      user: youthUsers[i]._id,
      registeredBy: youthUsers[i]._id,
      // Seeded members read as self-registered, which is the normal path now. A few are left
      // unverified so the roster shows both states.
      verificationStatus: i % 4 === 3 ? 'unverified' : 'verified',
    }));

    await YouthMember.insertMany(youthWithLogins);
    console.log(`Seeded ${youthData.length} youth members (${uniqueNames.size} distinct names)`);

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
        type: 'barangay_assembly',
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
    /*
     * One liquidation per remaining municipality, so Liquidations is not a Boac-only page.
     *
     * The three above are all Boac's — the same thinness that made Documents look broken to the
     * Gasan Secretary. Linked by title, never by array position, and the municipality is asserted
     * before the record is built so a mistake stops the seed instead of quietly filing a
     * liquidation against another municipality's programme.
     *
     * `submittedBy` is a role that could actually have submitted it: liquidations are FINANCE_STAFF
     * work, so Gasan and Mogpog — which have no chairperson or treasurer seeded — are attributed to
     * the provincial admin rather than to a secretary who would have been refused.
     */
    const extraLiquidations = [
      { code: 'GAS', title: 'Gasan Youth Skills and Livelihood Workshop', submitter: provincial,
        totalAmount: 62000, liquidatedAmount: 62000, status: 'approved',
        remarks: 'Full liquidation for the completed livelihood workshop.' },
      { code: 'MOG', title: 'Mogpog Youth Mental Health Forum', submitter: provincial,
        totalAmount: 34000, liquidatedAmount: 21000, status: 'submitted',
        remarks: 'Partial liquidation; awaiting receipts from the resource speaker.' },
      { code: 'STC', title: 'Sta. Cruz Barangay Reading Corner', submitter: chairStac,
        totalAmount: 40000, liquidatedAmount: 0, status: 'draft',
        remarks: 'Draft — compiling receipts for the book and shelving purchases.' },
    ];
    for (const spec of extraLiquidations) {
      const prog = byTitle[spec.title];
      if (!prog) throw new Error(`Seed error: no programme titled "${spec.title}" to liquidate`);
      if (prog.municipality.toString() !== munMap[spec.code]._id.toString()) {
        throw new Error(`Seed error: "${spec.title}" is not in ${spec.code}; the liquidation would cross municipalities`);
      }
      liquidationsData.push({
        title: `Liquidation — ${spec.title}`,
        program: prog._id,
        budget: budgetsByMun[spec.code]._id,
        municipality: munMap[spec.code]._id,
        totalAmount: spec.totalAmount,
        liquidatedAmount: spec.liquidatedAmount,
        status: spec.status,
        submittedBy: spec.submitter._id,
        ...(spec.status === 'draft' ? {} : { submittedAt: new Date('2026-05-10') }),
        ...(spec.status === 'approved'
          ? { reviewedBy: provincial._id, reviewedAt: new Date('2026-05-20'), approvedBy: provincial._id, approvedAt: new Date('2026-05-22') }
          : {}),
        dueDate: new Date('2026-06-30'),
        remarks: spec.remarks,
      });
    }

    const liquidations = [];
    // Sequential .save() — the reference-number counter depends on it; insertMany would skip the hook.
    for (const ld of liquidationsData) {
      liquidations.push(await new Liquidation(ld).save());
    }
    console.log(`Seeded ${liquidations.length} liquidations across ${new Set(liquidationsData.map((l) => l.municipality.toString())).size} municipalities`);

    // Seed documents
    const documentsData = [
      {
        title: 'SK Resolution No. 001 - Series of 2026',
        description: 'Resolution adopting the Annual Barangay Youth Investment Program (ABYIP) for FY 2026.',
        category: 'resolution',
        fileName: sampleFileName,
        originalName: 'SK-Resolution-001-2026.pdf',
        fileUrl: sampleFileUrl,
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
        fileName: sampleFileName,
        originalName: 'ABYIP-Boac-2026.pdf',
        fileUrl: sampleFileUrl,
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
        fileName: sampleFileName,
        originalName: 'SK-Boac-Annual-Budget-2026.xlsx',
        fileUrl: sampleFileUrl,
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
        fileName: sampleFileName,
        originalName: 'Liquidation-Health-Campaign.pdf',
        fileUrl: sampleFileUrl,
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
        fileName: sampleFileName,
        originalName: 'DILG-Compliance-Q1-2026.pdf',
        fileUrl: sampleFileUrl,
        fileType: 'application/pdf',
        fileSize: 156789,
        municipality: munMap['BOA']._id,
        uploadedBy: munAdmin._id,
        fiscalYear: 2026,
        isPublic: true,
        tags: ['compliance', 'dilg', 'q1'],
      },
      {
        // Filed under a category the standard list does not name, so the registry demonstrates
        // that document category accepts a typed value.
        title: 'Barangay Assembly Minutes — January 2026',
        description: 'Minutes of the SK Boac barangay assembly held January 2026.',
        category: 'barangay_assembly_minutes',
        fileName: sampleFileName,
        originalName: 'SK-Minutes-January-2026.docx',
        fileUrl: sampleFileUrl,
        fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        fileSize: 45678,
        municipality: munMap['STC']._id,
        uploadedBy: chairStac._id,
        fiscalYear: 2026,
        tags: ['minutes', 'session'],
      },
    ];
    /*
     * Every municipality gets its own documents.
     *
     * Five of the six above are Boac's and one is Sta. Cruz's, which left Gasan and Mogpog with an
     * empty Documents page — read by the panel as "the Secretary cannot see what the Chairperson
     * can" when the two were simply looking at different municipalities. Thin seed data has now
     * been reported as a defect four separate times, so the registry, the programmes and these all
     * spread deliberately.
     */
    const uploaderByCode = { BOA: chairBoac, STC: chairStac, GAS: anaGasan, MOG: provincial };
    const perMunicipalityDocs = [
      { category: 'cbydp', title: 'Comprehensive Barangay Youth Development Plan 2026-2028',
        description: 'Three-year youth development plan covering education, health and livelihood priorities.',
        ext: 'pdf', type: 'application/pdf', size: 431200, isPublic: true, tags: ['cbydp', 'planning'] },
      { category: 'minutes', title: 'SK Regular Session Minutes — February 2026',
        description: 'Minutes of the regular session, including approval of the quarterly work plan.',
        ext: 'pdf', type: 'application/pdf', size: 154300, isPublic: false, tags: ['minutes', 'session'] },
      { category: 'compliance_report', title: 'DILG Compliance Report — Q2 2026',
        description: 'Quarterly compliance submission covering fund utilisation and programme delivery.',
        ext: 'pdf', type: 'application/pdf', size: 298450, isPublic: true, tags: ['compliance', 'dilg'] },
    ];
    for (const [code, mun] of Object.entries(munMap)) {
      const uploader = uploaderByCode[code] || provincial;
      for (const d of perMunicipalityDocs) {
        const slug = `${d.category}-${code.toLowerCase()}-2026`;
        documentsData.push({
          title: `${d.title} — ${mun.name}`,
          description: d.description,
          category: d.category,
          fileName: sampleFileName,
          originalName: `${slug}.${d.ext}`,
          fileUrl: sampleFileUrl,
          fileType: d.type,
          fileSize: d.size,
          municipality: mun._id,
          uploadedBy: uploader._id,
          fiscalYear: 2026,
          isPublic: d.isPublic,
          tags: d.tags,
        });
      }
    }

    const documents = await Document.insertMany(documentsData);
    console.log(`Seeded ${documents.length} documents across ${Object.keys(munMap).length} municipalities`);

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
