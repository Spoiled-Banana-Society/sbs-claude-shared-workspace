#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const env = readFileSync('/private/tmp/claude-501/-Users-richardvagner/b1126e60-8c25-44a1-89b1-ae240ddf1637/scratchpad/sbs.env','utf8');
const line = env.split('\n').find(l => l.startsWith('FIREBASE_SERVICE_ACCOUNT_JSON='));
const sa = JSON.parse(line.slice(line.indexOf('{'), line.lastIndexOf('}')+1));
initializeApp({ credential: cert(sa) });
const db = getFirestore();
const q = await db.collection('marketplace_activity').limit(300).get();
console.log('activity docs:', q.size);
const types = {};
const rows=[];
q.forEach(s => { const d = s.data(); types[d.type||d.eventType||'?'] = (types[d.type||d.eventType||'?']||0)+1; rows.push(d); });
console.log('types:', JSON.stringify(types));
const sales = rows.filter(r => /sale|sold|purchase|buy/i.test(String(r.type||r.eventType||'')));
for (const r of sales.slice(0,6)) console.log(JSON.stringify(r).slice(0,300));
