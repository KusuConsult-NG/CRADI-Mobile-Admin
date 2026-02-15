import { Client, Databases, Account, Storage, Query } from 'appwrite';

// CRADI Mobile Appwrite Configuration
const client = new Client()
    .setEndpoint('https://fra.cloud.appwrite.io/v1')
    .setProject('6941cdb400050e7249d5');

export const databases = new Databases(client);
export const account = new Account(client);
export const storage = new Storage(client);

// Database and Collection IDs (from CRADI Mobile)
export const DATABASE_ID = '6941e2c2003705bb5a25';

export const COLLECTIONS = {
    USERS: 'users',
    REPORTS: 'reports',
    CHATS: 'chats',
    MESSAGES: 'messages',
    EMERGENCY_CONTACTS: 'emergency_contacts',
    TRUSTED_DEVICES: 'trusted_devices',
    LOGIN_HISTORY: 'login_history',
    KNOWLEDGE_BASE: 'knowledge_base',
} as const;

export const BUCKETS = {
    IMAGES: '6941e4e10034186aded8', // Shared bucket for all images
} as const;

export { client, Query };
