#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const env=readFileSync('.env.production','utf8');
const sa=JSON.parse(Buffer.from(env.match(/^FIREBASE_SERVICE_ACCOUNT_JSON=([A-Za-z0-9+/=]+)/m)[1],'base64').toString('utf8'));
initializeApp({credential:cert(sa)});
const db=getFirestore();
const sc=await db.collection('seasonConfig').get();
sc.docs.forEach(d=>console.log('seasonConfig/'+d.id+':', JSON.stringify(d.data()).slice(0,150)));
process.exit(0);
