import { NextRequest, NextResponse } from 'next/server';
import { Client, Users } from 'node-appwrite';

// Server-side client with API key
const client = new Client()
    .setEndpoint('https://fra.cloud.appwrite.io/v1')
    .setProject('6941cdb400050e7249d5')
    .setKey(process.env.APPWRITE_API_KEY || '');

const users = new Users(client);

export async function POST(request: NextRequest) {
    try {
        const { userId } = await request.json();

        if (!userId) {
            return NextResponse.json(
                { error: 'User ID is required' },
                { status: 400 }
            );
        }

        // Update Appwrite's built-in email verification status
        await users.updateEmailVerification(userId, true);

        return NextResponse.json({
            success: true,
            message: 'Email verification status updated successfully'
        });
    } catch (error: any) {
        console.error('Error updating email verification:', error);
        return NextResponse.json(
            {
                error: 'Failed to update email verification',
                details: error.message
            },
            { status: 500 }
        );
    }
}
