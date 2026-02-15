# CRADI Admin Panel

> **Web-based administration panel for CRADI Mobile**  
> Climate Risk & Disaster Intelligence Management

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/KusuConsult-NG/CRADI-Mobile-Admin)

## 📋 Overview

The CRADI Admin Panel is a Next.js web application that provides administrators with tools to manage the CRADI Mobile ecosystem, including user management, disaster report verification, and knowledge base administration.

## ✨ Features

- **User Management**: View, search, and manage CRADI Mobile users
- **Report Verification**: Verify, resolve, and manage disaster reports
- **Dashboard**: Real-time statistics and system overview
- **Role-Based Access**: Secure admin-only access with label verification
- **CRADI Branding**: Matches CRADI Mobile's visual identity

## 🚀 Quick Start

### Prerequisites

- Node.js 20+
- Appwrite Cloud account
- Access to CRADI Mobile project

### Installation

```bash
# Clone the repository
git clone https://github.com/KusuConsult-NG/CRADI-Mobile-Admin.git
cd CRADI-Mobile-Admin

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your Appwrite credentials

# Run development server
npm run dev
```

Access at http://localhost:3000

## 🔐 Database Setup

**Required: Set up database permissions before first use**

1. Get API Key from [Appwrite Console](https://cloud.appwrite.io/console)
2. Run permission setup:
   ```bash
   APPWRITE_API_KEY=your_key npm run setup:permissions
   ```
3. Create admin user:
   ```bash
   APPWRITE_API_KEY=your_key npm run create:admin
   ```

See [SETUP.md](./SETUP.md) for detailed instructions.

## 📝 Environment Variables

Create `.env.local` with:

```env
NEXT_PUBLIC_APP_NAME=CRADI Admin Panel
NEXT_PUBLIC_APPWRITE_ENDPOINT=https://fra.cloud.appwrite.io/v1
NEXT_PUBLIC_APPWRITE_PROJECT=6941cdb400050e7249d5
NEXT_PUBLIC_DATABASE_ID=6941e2c2003705bb5a25
```

## 🌐 Deployment

### Deploy to Vercel

1. Push code to GitHub (already done)
2. Import repository in Vercel
3. Add environment variables
4. Deploy!

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/KusuConsult-NG/CRADI-Mobile-Admin)

## 📚 Documentation

- [Setup Guide](./SETUP.md) - Complete setup instructions
- [Scripts Documentation](./scripts/README.md) - Database permission scripts
- [Walkthrough](./WALKTHROUGH.md) - Usage guide

## 🏗️ Project Structure

```
cradi-admin/
├── app/
│   ├── dashboard/          # Dashboard pages
│   │   ├── page.tsx        # Main dashboard
│   │   ├── users/          # User management
│   │   └── reports/        # Report management
│   └── login/              # Authentication
├── lib/
│   ├── appwrite.ts         # Appwrite SDK config
│   └── auth-context.tsx    # Auth provider with admin check
├── scripts/
│   ├── setup-permissions.js  # Permission configuration
│   ├── create-admin.js       # Admin user creation
│   └── check-permissions.js  # Permission audit
└── SETUP.md                # Setup documentation
```

## 🔒 Security

- **Admin-Only Access**: Only users with `admin` label can access
- **Session Validation**: Admin status verified on every request
- **API Key Protection**: Server API keys never exposed to client
- **Environment Variables**: Sensitive data in `.env.local` (gitignored)

## 🛠️ Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run setup:permissions` - Configure database permissions
- `npm run create:admin` - Create admin user
- `npm run check:permissions` - Audit permissions

## 🤝 Contributing

This repository is part of the CRADI Mobile ecosystem developed by KusuConsult-NG.

## 📄 License

Private - KusuConsult-NG

## 🔗 Related Projects

- [CRADI Mobile](https://github.com/KusuConsult-NG/CRADI-mobile) - Flutter mobile application

---

**Built with** Next.js 16 • React • TypeScript • Appwrite • Tailwind CSS
