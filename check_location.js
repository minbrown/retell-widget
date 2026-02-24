import fetch from "node-fetch";
import "dotenv/config";

async function check() {
    const res = await fetch("https://services.leadconnectorhq.com/locations/search?limit=10", {
        headers: {
            Authorization: `Bearer ${process.env.GHL_API_KEY}`,
            Version: "2021-07-28"
        }
    });
    const data = await res.json();
    console.log("LOCATIONS:", JSON.stringify(data, null, 2));
}
check();
