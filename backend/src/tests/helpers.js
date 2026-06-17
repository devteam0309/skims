const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Municipality = require('../models/Municipality');
const Budget = require('../models/Budget');
const Program = require('../models/Program');

const createMunicipality = async (overrides = {}) => {
  return Municipality.create({
    name: `Municipality ${Math.random().toString(36).slice(2, 8)}`,
    code: Math.random().toString(36).slice(2, 8).toUpperCase(),
    ...overrides,
  });
};

const createUser = async (overrides = {}) => {
  const municipality = overrides.municipality || (await createMunicipality())._id;
  const user = await User.create({
    firstName: 'Test',
    lastName: 'User',
    email: `user-${Math.random().toString(36).slice(2)}@example.com`,
    password: 'Test@1234',
    role: 'municipal_admin',
    isEmailVerified: true,
    isActive: true,
    isApproved: true,
    municipality,
    ...overrides,
    // municipality override after spread so it wins if explicitly passed
  });
  const token = jwt.sign(
    { id: user._id, role: user.role },
    process.env.JWT_SECRET || 'skims-test-secret-key-for-testing-only',
    { expiresIn: '1h' }
  );
  return { user, token, municipalityId: municipality };
};

const createBudget = async (municipalityId, createdBy, overrides = {}) => {
  return Budget.create({
    title: 'Test Budget',
    fiscalYear: 2026,
    municipality: municipalityId,
    totalBudget: 500000,
    approvedAmount: 500000,
    disbursedAmount: 0,
    remainingBalance: 500000,
    status: 'approved',
    approvedBy: createdBy,
    approvedAt: new Date(),
    createdBy,
    ...overrides,
  });
};

const createProgram = async (municipalityId, createdBy, overrides = {}) => {
  return Program.create({
    title: 'Test Program',
    description: 'A test program for unit testing purposes',
    category: 'education',
    municipality: municipalityId,
    budget: 100000,
    startDate: new Date('2026-01-01'),
    endDate: new Date('2026-12-31'),
    targetParticipants: 50,
    createdBy,
    ...overrides,
  });
};

const authHeader = (token) => ({ Authorization: `Bearer ${token}` });

module.exports = { createUser, createMunicipality, createBudget, createProgram, authHeader };
