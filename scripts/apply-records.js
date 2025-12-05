const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");

const TOKEN = process.env.DESEC_TOKEN;
const DOMAIN = "is-dev.me";
const BASE = `https://desec.io/api/v1/domains/${DOMAIN}/rrsets/`;
const DOMAIN_INFO = `https://desec.io/api/v1/domains/${DOMAIN}/`;

const SUPPORTED_TYPES = ["A","AAAA","CAA","CNAME","MX","NS","TXT","SRV","PTR","NAPTR","SPF","TLSA","DS","SSHFP"];

async function enableDNSSEC() {
  const r = await fetch(DOMAIN_INFO, {
    method: "PATCH",
    headers: { Authorization: `Token ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ dnssec: true })
  });
  if (!r.ok && r.status !== 400) console.warn("DNSSEC warning:", await r.text());
}

async function putOrPost(url, payloads) {
  let r = await fetch(url, {
    method: "PUT",
    headers: { Authorization: `Token ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(payloads[0])
  });
  if (!r.ok && r.status !== 404) {
    r = await fetch(BASE, {
      method: "POST",
      headers: { Authorization: `Token ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(payloads)
    });
  }
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`API error ${r.status}: ${err}`);
  }
  return r;
}

async function applyRecords() {
  console.log("=== DNS Apply + DNSSEC Started ===\n");
  await enableDNSSEC();

  const files = fs.readdirSync("./records").filter(f => f.endsWith(".json"));
  if (!files.length) return console.log("No JSON files in /records");

  for (const file of files) {
    console.log(`\nProcessing: ${file}`);
    const data = JSON.parse(fs.readFileSync(path.join("./records", file), "utf8"));

    const subname = (data.subdomain || "").trim().toLowerCase();
    if (!subname) throw new Error(`"subdomain" missing in ${file}`);

    if (Array.isArray(data.record)) {
      const records = data.record.map(v => v.trim()).filter(Boolean).map(v => v.endsWith(".") ? v : v + ".");
      console.log(`Applying NS → ${subname}.${DOMAIN} → ${records.join(", ")}`);
      await putOrPost(`${BASE}${subname}/NS/`, [{ subname, type: "NS", ttl: 3600, records }]);
      console.log(`NS applied (${records.length})`);
      continue;
    }

    if (data.records && typeof data.records === "object") {
      for (const [typeRaw, value] of Object.entries(data.records)) {
        const type = typeRaw.toUpperCase();
        if (!SUPPORTED_TYPES.includes(type)) throw new Error(`Unsupported type ${type} in ${file}`);

        let records = Array.isArray(value) ? value : [value];
        records = records.map(v => v.trim()).filter(Boolean);
        records = records.map(r => ["CNAME","NS","PTR","MX","DNAME"].includes(type) && !r.endsWith(".") ? r + "." : r);

        console.log(`Applying ${type} → ${subname}.${DOMAIN} → ${records.join(" | ")}`);
        await putOrPost(`${BASE}${subname}/${type}/`, [{ subname, type, ttl: 3600, records }]);
        console.log(`${type} applied`);
      }
      continue;
    }

    throw new Error(`File ${file} must contain "record" (array) or "records" (object)`);
  }

  console.log("\nAll records applied + DNSSEC active!");
}

applyRecords().catch(err => {
  console.error("\nERROR:", err.message);
  process.exit(1);
});
