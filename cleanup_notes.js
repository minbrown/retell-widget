import fetch from 'node-fetch';
import 'dotenv/config';

const CONTACT_ID = '31BIsQeQs0EGW6Ky1z4N';
const GHL_API_KEY = process.env.GHL_API_KEY;

const GHL_HEADERS = {
    Authorization: `Bearer ${GHL_API_KEY}`,
    'Content-Type': 'application/json',
    Version: '2021-07-28',
};

async function cleanup() {
    console.log(`🧹 Cleaning up notes for contact: ${CONTACT_ID}...`);

    try {
        // 1. Get all notes
        const res = await fetch(`https://services.leadconnectorhq.com/contacts/${CONTACT_ID}/notes`, {
            headers: GHL_HEADERS,
        });

        if (!res.ok) {
            throw new Error(`Failed to fetch notes: ${await res.text()}`);
        }

        const data = await res.json();
        const notes = data.notes || [];

        console.log(`   Found ${notes.length} total notes.`);

        // 2. Filter notes that contain "Outcome: undefined" or "Sentiment: undefined"
        const junkNotes = notes.filter(n =>
            n.body && (n.body.includes('Outcome: undefined') || n.body.includes('Sentiment: undefined'))
        );

        console.log(`   Found ${junkNotes.length} junk notes to delete.`);

        // 3. Delete each junk note
        for (const note of junkNotes) {
            console.log(`   Deleting note ${note.id}...`);
            const delRes = await fetch(`https://services.leadconnectorhq.com/contacts/${CONTACT_ID}/notes/${note.id}`, {
                method: 'DELETE',
                headers: GHL_HEADERS,
            });

            if (delRes.ok) {
                console.log(`   ✅ Deleted.`);
            } else {
                console.error(`   ❌ Failed to delete ${note.id}:`, await delRes.text());
            }
            // Small delay to avoid rate limiting
            await new Promise(r => setTimeout(r, 200));
        }

        console.log('✨ Cleanup complete.');
    } catch (err) {
        console.error('💥 Cleanup failed:', err.message);
    }
}

cleanup();
