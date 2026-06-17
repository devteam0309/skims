# SKIMS — Sangguniang Kabataan Integrated Program and Fund Management System

A production-ready full-stack web platform for SK (Sangguniang Kabataan) officials in the municipalities of Boac, Sta. Cruz, Gasan, and Mogpog in Marinduque, Philippines.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite, Tailwind CSS, Framer Motion, Recharts |
| State | Zustand + TanStack Query |
| Forms | React Hook Form + Zod |
| Backend | Node.js + Express.js |
| Database | MongoDB + Mongoose |
| Auth | JWT + RBAC |
| Storage | Multer (local) / Cloudinary (optional) |
| Reports | PDFKit + ExcelJS |
| DevOps | Docker + Nginx + GitHub Actions |

## Quick Start

### Prerequisites
- Node.js 18+
- MongoDB 7.0+
- npm or yarn

### 1. Backend Setup

```bash
cd backend
cp .env.example .env
# Edit .env with your MongoDB URI and JWT secret
npm install
npm run seed        # Seed demo data
npm run dev         # Start dev server on port 5000
```

### 2. Frontend Setup

```bash
cd frontend
npm install
npm run dev         # Start dev server on port 5173
```

### 3. Docker (Production)

```bash
# Copy and configure environment
cp backend/.env.example backend/.env
# Edit backend/.env

docker compose up -d --build
```

Access: http://localhost

## Demo Accounts

| Role | Email | Password |
|------|-------|----------|
| Super Admin | superadmin@skims.gov.ph | Admin@123 |
| Provincial Admin | provincial@skims.gov.ph | Admin@123 |
| Municipal Admin | municipal@boac.gov.ph | Admin@123 |
| SK Chairperson | juan@boac.gov.ph | Admin@123 |
| SK Treasurer | maria@boac.gov.ph | Admin@123 |
| DILG Officer | dilg@marinduque.gov.ph | Admin@123 |
| Public User | youth@example.com | Admin@123 |

## Project Structure

```
skims/
├── backend/                    # Express.js API
│   ├── src/
│   │   ├── config/             # Database, Cloudinary config
│   │   ├── controllers/        # Route controllers
│   │   ├── middleware/         # Auth, RBAC, error handler
│   │   ├── models/             # Mongoose models
│   │   ├── routes/             # Express routes
│   │   ├── services/           # Email, notification services
│   │   ├── utils/              # Logger, API response helpers
│   │   └── seeders/            # Demo data seeders
│   └── server.js
├── frontend/                   # React + Vite
│   └── src/
│       ├── components/         # Reusable UI components
│       ├── pages/              # Application pages
│       ├── services/           # API service layer
│       ├── store/              # Zustand stores
│       └── utils/              # Formatters, constants
├── docker-compose.yml
└── .github/workflows/ci.yml    # CI/CD pipeline
```

## System Modules

1. **Authentication** — JWT auth, email verification, password reset, account approval
2. **Dashboard** — Role-based KPIs, charts, activity feeds
3. **Program Management** — Create, track, and report on youth programs with milestones
4. **Fund Management** — Budgets, expenses (full PR→PO→DR→IAR→SI→DV→OR→Liquidation workflow)
5. **Document Management** — Upload, categorize, version, archive documents
6. **Monitoring & Evaluation** — Real-time compliance, delay tracking, municipality comparison
7. **Analytics** — Fund utilization trends, program success rates, youth engagement
8. **Reports** — PDF/Excel generation (programs, financial, youth)
9. **Notifications** — In-app and email notifications for deadlines and approvals
10. **Public Portal** — Transparency portal (no login required)
11. **Youth Registry** — Track youth members and program participation
12. **User Management** — 9-role RBAC with approval workflow

## API Documentation

Base URL: `http://localhost:5000/api`

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /auth/register | Register new user |
| POST | /auth/login | Login |
| GET | /auth/me | Get current user |
| GET | /auth/logout | Logout |
| POST | /auth/forgot-password | Request password reset |
| PUT | /auth/reset-password/:token | Reset password |
| GET | /auth/verify-email/:token | Verify email |

### Programs
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /programs | List programs |
| POST | /programs | Create program |
| GET | /programs/:id | Get program |
| PUT | /programs/:id | Update program |
| DELETE | /programs/:id | Delete program |
| PATCH | /programs/:id/status | Update status |
| POST | /programs/:id/milestones | Add milestone |

### Budgets
| GET/POST | /budgets | List/Create |
| PATCH | /budgets/:id/approve | Approve budget |
| PATCH | /budgets/:id/submit | Submit for approval |

### Expenses, Liquidations, Documents, Reports
Follow similar RESTful patterns. See `/api/health` for system status.

## Security Features

- JWT authentication with HttpOnly considerations
- Role-Based Access Control (9 roles)
- Rate limiting (100 req/10min general, 20 req/15min for auth)
- MongoDB injection prevention (express-mongo-sanitize)
- XSS protection (helmet, hpp)
- CORS configured for frontend origin
- Password hashing (bcrypt, 12 rounds)
- Account lockout after 5 failed attempts
- Soft deletes (deletedAt field)
- Comprehensive audit logging

## Environment Variables (backend/.env)

```env
NODE_ENV=production
PORT=5000
MONGO_URI=mongodb://localhost:27017/skims
JWT_SECRET=your_min_32_char_secret
JWT_EXPIRE=7d
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_EMAIL=your@email.com
SMTP_PASSWORD=app_password
FROM_EMAIL=noreply@skims.gov.ph
CLIENT_URL=https://your-domain.com
```

## License

Built for Sangguniang Kabataan of Marinduque, Philippines.
