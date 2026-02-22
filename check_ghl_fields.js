
import fetch from "node-fetch";
import "dotenv/config";

async function checkGHLFields() {
    const GHL_API_KEY = process.env.GHL_API_KEY;
    const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID;

    if (!GHL_API_KEY || !GHL_LOCATION_ID) {
        console.error("Missing GHL_API_KEY or GHL_LOCATION_ID in .env");
        return;
    }

    const url = `https://services.leadconnectorhq.com/locations/${GHL_LOCATION_ID}/customFields`;
    const options = {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${GHL_API_KEY}`,
            Version: '2021-07-28'
        }
    };

    try {
        const res = await fetch(url, options);
        if (!res.ok) {
            console.error(`Error fetching fields: ${res.status} ${res.statusText}`);
            console.log(await res.text());
            return;
        }
        const data = await res.json();
        console.log("Found Custom Fields:");
        data.customFields.forEach(f => {
            console.log(`- Name: ${f.name} | Key: ${f.fieldKey} | ID: ${f.id}`);
        });
    } catch (err) {
        console.error("Fetch error:", err.message);
    }
}

checkGHLFields();
