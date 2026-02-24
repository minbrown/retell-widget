import fetch from "node-fetch";
import "dotenv/config";

async function check() {
    const GHL_HEADERS = {
        Authorization: `Bearer ${process.env.GHL_API_KEY}`,
        Version: "2021-07-28"
    };
    const res = await fetch(`https://services.leadconnectorhq.com/users/?locationId=${process.env.GHL_LOCATION_ID}`, { headers: GHL_HEADERS });
    const data = await res.json();
    console.log("USERS:", JSON.stringify(data, null, 2));
}
check();
