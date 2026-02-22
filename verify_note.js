import fetch from 'node-fetch';
import 'dotenv/config';

const CONTACT_ID = 'qtSj4bnZ8AQEFhgE8046';
const GHL_API_KEY = process.env.GHL_API_KEY;

const GHL_HEADERS = {
    Authorization: `Bearer ${GHL_API_KEY}`,
    'Content-Type': 'application/json',
    Version: '2021-07-28',
};

async function verify() {
    console.log(`🔍 Verifying notes for contact: ${CONTACT_ID}...`);
    try {
        const res = await fetch(`https://services.leadconnectorhq.com/contacts/${CONTACT_ID}/notes`, {
            headers: GHL_HEADERS,
        });
        const data = await res.json();
        const notes = data.notes || [];

        if (notes.length > 0) {
            console.log(`✅ Found ${notes.length} note(s).`);
            console.log(`📝 Latest Note Body:\n${notes[0].body}`);
        } else {
            console.log('❌ No notes found for this contact.');
        }
    } catch (err) {
        console.error('💥 Verification failed:', err.message);
    }
}

verify();
