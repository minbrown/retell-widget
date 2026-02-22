import fetch from 'node-fetch';
import 'dotenv/config';

const CONTACT_ID = 'qtSj4bnZ8AQEFhgE8046';
const GHL_API_KEY = process.env.GHL_API_KEY;

const GHL_HEADERS = {
    Authorization: `Bearer ${GHL_API_KEY}`,
    'Content-Type': 'application/json',
    Version: '2021-07-28',
};

async function testNote() {
    console.log(`🧪 Testing note creation for contact: ${CONTACT_ID}...`);

    const body = {
        body: 'Test Note from Debug Script\nOutcome: Success\nSummary: This is a test.'
    };

    try {
        const res = await fetch(`https://services.leadconnectorhq.com/contacts/${CONTACT_ID}/notes`, {
            method: 'POST',
            headers: GHL_HEADERS,
            body: JSON.stringify(body),
        });

        if (res.ok) {
            const data = await res.json();
            console.log('✅ Note created successfully:', JSON.stringify(data));
        } else {
            console.error('❌ Failed to create note:', res.status, await res.text());
        }
    } catch (err) {
        console.error('💥 Error:', err.message);
    }
}

testNote();
