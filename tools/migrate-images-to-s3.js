/**
 * Rewrites every image path stored in the DB (/iq-test/1.png, ./avatar/x.png)
 * to its S3 URL. Walks every collection and every string field, so no field
 * list to keep in sync; only exact matches against the manifest are touched.
 *
 *   NODE_ENV=production node tools/migrate-images-to-s3.js            # dry run
 *   NODE_ENV=production node tools/migrate-images-to-s3.js --apply
 *   NODE_ENV=production node tools/migrate-images-to-s3.js --revert tools/migration-backups/<file>.json
 *
 * --apply writes a backup of every changed value first; --revert replays it.
 */
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { connectDb, disconnectDb } = require("../src/config/db");

const BASE = "https://testbrain-buzzinga.s3.eu-north-1.amazonaws.com";
const manifestPath =
    process.env.IMAGE_MANIFEST ||
    path.join(__dirname, "migration-backups", "used-images.txt");

const apply = process.argv.includes("--apply");
const revertIdx = process.argv.indexOf("--revert");
const revertFile = revertIdx > -1 ? process.argv[revertIdx + 1] : null;

// "/x.png" | "./x.png" | "x.png" -> "/x.png"
const norm = (s) => "/" + s.trim().replace(/^(\.\/|\/)+/, "");

const loadMap = () => {
    const map = new Map();
    for (const line of fs.readFileSync(manifestPath, "utf8").split("\n")) {
        const p = line.trim();
        if (p) map.set(norm(p), BASE + norm(p));
    }
    return map;
};

// Collects [dotPath, old, new] for every string in doc that maps.
const walk = (val, map, keyPath, out) => {
    if (typeof val === "string") {
        const hit = map.get(norm(val));
        if (hit && val !== hit) out.push([keyPath, val, hit]);
    } else if (Array.isArray(val)) {
        val.forEach((v, i) => walk(v, map, `${keyPath}.${i}`, out));
    } else if (val && typeof val === "object" && !(val instanceof Date) && !val._bsontype) {
        for (const [k, v] of Object.entries(val)) {
            if (k === "_id") continue;
            walk(v, map, keyPath ? `${keyPath}.${k}` : k, out);
        }
    }
};

const run = async () => {
    await connectDb();
    const db = mongoose.connection.db;
    const env = process.env.NODE_ENV || "development";

    if (revertFile) {
        const backup = JSON.parse(fs.readFileSync(revertFile, "utf8"));
        let n = 0;
        for (const [coll, docs] of Object.entries(backup.changes)) {
            const ops = docs.map(({ _id, fields }) => ({
                updateOne: {
                    filter: { _id: new mongoose.Types.ObjectId(_id) },
                    update: { $set: Object.fromEntries(fields.map(([p, old]) => [p, old])) },
                },
            }));
            if (ops.length) {
                const r = await db.collection(coll).bulkWrite(ops);
                n += r.modifiedCount;
            }
        }
        console.log(`reverted ${n} docs from ${revertFile}`);
        await disconnectDb();
        return;
    }

    const map = loadMap();
    const changes = {};
    let docCount = 0;
    let fieldCount = 0;
    const unmapped = new Map(); // image-looking strings we did NOT touch

    for (const { name } of await db.collection("system.namespaces").find().toArray().catch(() => [])) void name;
    const colls = (await db.listCollections().toArray()).map((c) => c.name);

    for (const coll of colls) {
        const docs = await db.collection(coll).find({}).toArray();
        for (const doc of docs) {
            const out = [];
            walk(doc, map, "", out);
            if (out.length) {
                (changes[coll] = changes[coll] || []).push({ _id: String(doc._id), fields: out });
                docCount++;
                fieldCount += out.length;
            }
            // surface any image path we are leaving behind
            const stray = [];
            const scan = (v, kp) => {
                if (typeof v === "string" && /\.(png|jpe?g|svg|gif|webp)$/i.test(v.trim()) && !v.startsWith("http") && !map.has(norm(v))) stray.push([kp, v]);
                else if (Array.isArray(v)) v.forEach((x, i) => scan(x, `${kp}.${i}`));
                else if (v && typeof v === "object" && !(v instanceof Date) && !v._bsontype) for (const [k, x] of Object.entries(v)) scan(x, kp ? `${kp}.${k}` : k);
            };
            scan(doc, "");
            for (const [kp, v] of stray) unmapped.set(`${coll}:${kp}=${v}`, true);
        }
    }

    console.log(`[${env}] ${apply ? "APPLY" : "DRY RUN"}: ${fieldCount} fields across ${docCount} docs would change`);
    for (const [coll, docs] of Object.entries(changes)) {
        const fields = docs.reduce((a, d) => a + d.fields.length, 0);
        console.log(`  ${coll}: ${docs.length} docs, ${fields} fields`);
    }
    if (unmapped.size) {
        console.log(`  WARNING ${unmapped.size} image-like strings NOT in manifest (left untouched):`);
        [...unmapped.keys()].slice(0, 10).forEach((k) => console.log("    " + k));
    } else {
        console.log("  no image-like strings left unmapped");
    }
    const sample = Object.values(changes)[0]?.[0]?.fields?.[0];
    if (sample) console.log(`  example: ${sample[1]}  ->  ${sample[2]}`);

    if (apply && docCount) {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const backupPath = path.join(__dirname, "migration-backups", `images-${env}-${stamp}.json`);
        fs.writeFileSync(backupPath, JSON.stringify({ env, base: BASE, at: stamp, changes }, null, 1));
        console.log(`  backup -> ${path.relative(process.cwd(), backupPath)}`);

        let modified = 0;
        for (const [coll, docs] of Object.entries(changes)) {
            const ops = docs.map(({ _id, fields }) => ({
                updateOne: {
                    filter: { _id: new mongoose.Types.ObjectId(_id) },
                    update: { $set: Object.fromEntries(fields.map(([p, , nu]) => [p, nu])) },
                },
            }));
            const r = await db.collection(coll).bulkWrite(ops);
            modified += r.modifiedCount;
        }
        console.log(`  applied: ${modified} docs modified`);
    }

    await disconnectDb();
};

run().catch((e) => {
    console.error(e);
    process.exit(1);
});
