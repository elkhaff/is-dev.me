const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");

// ================== CONFIG ==================
const TOKEN = process.env.DESEC_TOKEN;
const DOMAIN = "is-dev.me";
const BASE = `https://desec.io/api/v1/domains/${DOMAIN}/rrsets`;

// Supported record types by deSEC
const SUPPORTED = [
  "A","AAAA","AFSDB","CAA","CNAME","DNAME","DS","HINFO",
  "HTTPS","LOC","MX","NAPTR","NS","PTR","RP","SPF","SRV",
  "SSHFP","SVCB","TLSA","TXT"
];

async function apply() {
  console.log("=== DNS Apply Process Started ===");

  const files = fs.readdirSync("./records").filter(f => f.endsWith(".json"));
  if (files.length === 0) {
    console.log("No JSON files found inside /records");
    return;
  }

  for (const file of files) {
    console.log(`\nProcessing: ${file}`);

    const data = JSON.parse(
      fs.readFileSync(path.join("./records", file), "utf8")
    );

    const username = data.owner.username;
    const subname = username;
    const recordsObj = data.records;

    if (!recordsObj || typeof recordsObj !== "object") {
      throw new Error(`Invalid "records" object in file: ${file}`);
    }

    for (const type in recordsObj) {
      const rawValue = recordsObj[type];
      const recordType = type.toUpperCase();

      if (!SUPPORTED.includes(recordType)) {
        throw new Error(`Record type "${recordType}" is not supported by deSEC.`);
      }

      let value = rawValue.trim();

      if (["CNAME", "NS", "PTR", "DNAME"].includes(recordType) && !value.endsWith(".")) {
        value += ".";
      }

      const payload = {
        subname,
        type: recordType,
        records: [value],
        ttl: 3600
      };

      const url = `${BASE}/${subname}/${recordType}/`;

      console.log(`Applying ${recordType} record: ${subname}.${DOMAIN} → ${value}`);

      // Try PUT (create/update)
      let r = await fetch(url, {
        method: "PUT",
        headers: {
          Authorization: `Token ${TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      // If PUT fails, try POST
      if (!r.ok) {
        console.log(`PUT failed (${r.status}). Trying POST...`);
        r = await fetch(BASE + "/", {
          method: "POST",
          headers: {
            Authorization: `Token ${TOKEN}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify([payload])
        });
      }

      if (!r.ok) {
        const errMsg = await r.text();
        throw new Error(
          `Failed to apply record (${recordType}) for ${subname}.${DOMAIN}\nServer Response:\n${errMsg}`
        );
      }

      console.log(`✔ Successfully applied ${recordType} record`);
    }
  }

  console.log("\n=== DNS Apply Process Completed ===");
}

apply().catch(err => {
  console.error("\nERROR:", err.message);
  process.exit(1);
});
